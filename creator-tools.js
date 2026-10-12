(function (global) {
  'use strict';

  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[index] = value >>> 0;
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    function header(size) { return new DataView(new ArrayBuffer(size)); }
    function bytesOf(view) { return new Uint8Array(view.buffer); }

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
      const checksum = crc32(data);
      const local = header(30);
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, checksum, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      const localBytes = bytesOf(local);
      localParts.push(localBytes, name, data);

      const central = header(46);
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, dosTime, true);
      central.setUint16(14, dosDate, true);
      central.setUint32(16, checksum, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, name.length, true);
      central.setUint16(30, 0, true);
      central.setUint16(32, 0, true);
      central.setUint16(34, 0, true);
      central.setUint16(36, 0, true);
      central.setUint32(38, 0, true);
      central.setUint32(42, localOffset, true);
      const centralBytes = bytesOf(central);
      centralParts.push(centralBytes, name);
      localOffset += localBytes.length + name.length + data.length;
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = header(22);
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, localOffset, true);
    end.setUint16(20, 0, true);
    const parts = [...localParts, ...centralParts, bytesOf(end)];
    const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { archive.set(part, offset); offset += part.length; }
    return archive;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createZip, crc32 };
  if (!global.document) return;

  const doc = global.document;
  const main = doc.querySelector('main');
  const sidebar = doc.querySelector('aside');
  const projectView = main?.querySelector('.content');
  if (!main || !sidebar || !projectView) return;

  const toolLabel = doc.createElement('p');
  toolLabel.className = 'section-label tool-section-label';
  toolLabel.textContent = 'Outils créatifs';
  const toolNav = doc.createElement('nav');
  toolNav.className = 'tool-nav';
  toolNav.setAttribute('aria-label', 'Outils créatifs');
  toolNav.innerHTML = '<button type="button" data-view="projects" aria-current="page"><span aria-hidden="true">▦</span>Mes projets</button><button type="button" data-view="addons"><span aria-hidden="true">◆</span>Add-ons Minecraft</button><button type="button" data-view="animation"><span aria-hidden="true">▻</span>Animation vidéo</button>';
  sidebar.querySelector('.side-note')?.before(toolLabel, toolNav);

  projectView.id = 'projects-view';
  main.insertAdjacentHTML('beforeend', `
    <section class="tool-view" id="addons-view" hidden aria-labelledby="addons-title">
      <p class="eyebrow">Atelier Minecraft</p>
      <h1 id="addons-title">Créez votre add-on</h1>
      <p class="intro tool-intro">Imaginez un objet, personnalisez son icône et exportez un pack prêt à importer.</p>
      <div class="addon-layout">
        <form class="addon-form" id="addon-form">
          <div class="addon-fields">
            <div class="field"><label for="addon-name">Nom de l’objet</label><input id="addon-name" maxlength="40" required value="Cristal solaire"></div>
            <div class="field"><label for="addon-id">Identifiant technique</label><div class="identifier"><span>hefcreative:</span><input id="addon-id" maxlength="32" pattern="[a-z0-9_]+" required value="cristal_solaire" aria-describedby="addon-id-help"></div><small id="addon-id-help">Lettres minuscules, chiffres et tirets bas.</small></div>
            <div class="field"><label for="addon-description">Description</label><textarea id="addon-description" maxlength="120" placeholder="Décrivez votre objet…">Un cristal façonné dans la lumière du soleil.</textarea></div>
            <div class="addon-options"><div class="field"><label for="addon-stack">Taille de pile</label><select id="addon-stack"><option>1</option><option>16</option><option selected>64</option></select></div><label class="check-field"><input id="addon-hand" type="checkbox"> Tenir l’objet comme un outil</label></div>
            <div class="field"><label for="addon-color">Couleur de l’icône</label><div class="texture-controls"><input id="addon-color" type="color" value="#eaa44e" aria-label="Couleur de l’icône"><label class="upload-texture" for="addon-texture">Importer une texture PNG</label><input class="visually-hidden" id="addon-texture" type="file" accept="image/png,image/jpeg,image/webp"></div><small>La texture importée sera adaptée en 16 × 16 pixels.</small></div>
            <button class="primary" type="submit"><span aria-hidden="true">↓</span> Télécharger le .mcaddon</button>
            <p class="tool-status" id="addon-status" role="status" aria-live="polite">Le pack contient un objet personnalisé et son icône.</p>
          </div>
        </form>
        <div class="addon-preview" aria-label="Aperçu de l’objet Minecraft">
          <div class="preview-heading"><span>APERÇU EN JEU</span><span class="preview-version">BEDROCK</span></div>
          <div class="item-stage"><canvas id="addon-preview" width="16" height="16" aria-label="Icône de l’objet"></canvas></div>
          <h2 id="addon-preview-name">Cristal solaire</h2>
          <p id="addon-preview-id">hefcreative:cristal_solaire</p>
          <div class="preview-divider"></div>
          <div class="pack-includes"><span class="pack-check">✓</span><span><strong>Pack de comportement</strong><small>Définition de l’objet et ses propriétés</small></span></div>
          <div class="pack-includes"><span class="pack-check">✓</span><span><strong>Pack de ressources</strong><small>Texture et atlas d’icônes personnalisés</small></span></div>
        </div>
      </div>
    </section>
    <section class="tool-view animation-view" id="animation-view" hidden aria-label="Animation Desk">
      <header class="desk-topbar">
        <nav class="desk-tabs" aria-label="Navigation Animation Desk"><button type="button" id="projects-tab">Projects</button><button type="button" id="library-tab">Library</button><button type="button" id="actions-tab" aria-expanded="false">Actions</button></nav>
        <span class="desk-document-name">Sans titre <span>●</span></span>
        <div class="desk-top-controls"><button class="desk-icon" type="button" id="play-animation" aria-label="Lire l’animation" title="Lire">▶</button><label title="Taille du pinceau"><input id="brush-size" type="range" min="1" max="28" value="5"><output id="brush-size-value">5</output></label><label title="Zoom de la scène"><input id="zoom-control" type="range" min="50" max="150" value="100"></label><button class="desk-export" id="export-video" type="button">Exporter</button></div>
      </header>
      <div class="desk-workspace">
        <nav class="desk-tool-rail" aria-label="Outils de dessin">
          <button type="button" data-tool="cursor" title="Pointeur" aria-label="Pointeur">↖</button><button type="button" data-tool="select" title="Sélection" aria-label="Sélection">▧</button><span></span><button class="selected" type="button" data-tool="brush" title="Pinceau" aria-label="Pinceau">╱</button><button type="button" data-tool="erase" title="Gomme" aria-label="Gomme">◩</button><button type="button" data-tool="smudge" title="Flou" aria-label="Flou">✋</button><button type="button" data-tool="fill" title="Remplir le calque" aria-label="Remplir le calque">◒</button><button type="button" data-tool="eyedropper" title="Pipette" aria-label="Pipette">⌖</button><button type="button" data-tool="text" title="Texte" aria-label="Texte">T</button><button type="button" data-tool="pen" title="Trait" aria-label="Trait">／</button>
          <button class="desk-tool-bottom" id="undo-frame" type="button" title="Annuler le dernier trait" aria-label="Annuler">↶</button><button id="clear-frame" type="button" title="Effacer l’image" aria-label="Effacer l’image">⌫</button>
        </nav>
        <div class="desk-stage-column">
          <div class="desk-canvas-area"><div class="canvas-matte"><canvas id="drawing-canvas" width="640" height="400" aria-label="Zone de dessin de l’image courante" role="img"></canvas></div></div>
          <div class="desk-stage-bar"><div class="stage-left-controls"><button id="previous-frame" type="button" title="Image précédente" aria-label="Image précédente">|◀</button><button id="next-frame" type="button" title="Image suivante" aria-label="Image suivante">▶|</button><button id="stage-onion" type="button" aria-pressed="true" title="Pelure d’oignon" aria-label="Pelure d’oignon">◐</button><button id="loop-playback" type="button" aria-pressed="true" title="Lecture en boucle" aria-label="Lecture en boucle">⟳</button></div><div class="stage-transport"><button id="stage-to-first" type="button" title="Revenir à la première image" aria-label="Revenir à la première image">≪</button><button id="stage-play" type="button" title="Lire l’animation" aria-label="Lire l’animation">▶</button><button id="stage-to-last" type="button" title="Aller à la dernière image" aria-label="Aller à la dernière image">≫</button></div><span class="stage-scene">Scene 1</span><label class="stage-fps">24 fps <select id="animation-fps" aria-label="Images par seconde"><option>4</option><option>8</option><option>12</option><option>16</option><option selected>24</option></select></label><span id="animation-status" role="status" aria-live="polite">Prêt</span><button id="toggle-timeline-stage" type="button" aria-label="Replier la timeline" title="Replier la timeline">▾</button></div>
        </div>
        <aside class="desk-inspector" aria-label="Réglages"><button type="button" id="color-swatch" title="Choisir une couleur" aria-label="Choisir une couleur"><input id="brush-color" type="color" value="#111111" aria-label="Couleur du pinceau"></button><button type="button" id="toggle-layers" aria-label="Afficher les calques" title="Calques">◆</button><button type="button" id="toggle-settings" aria-label="Réglages du pinceau" title="Réglages">☷</button><div class="brush-settings" id="brush-settings" hidden><label>Taille <output id="brush-size-side">5 px</output><input id="brush-size-side-control" type="range" min="1" max="28" value="5"></label><label class="onion-setting"><input id="onion-skin" type="checkbox" checked> Pelure d’oignon</label><label>Nombre de boucles<select id="loop-count"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="5">5</option></select></label><label>Nom du fichier<input id="animation-name" type="text" value="mon-animation" maxlength="40"></label></div><label class="visually-hidden">Épaisseur <output id="brush-size-value-accessible">5 px</output></label></aside>
      </div>
      <section class="desk-timeline" id="desk-timeline" aria-label="Timeline de l’animation">
        <header class="timeline-topbar"><div class="timeline-top-left"><button type="button" id="toggle-timeline" aria-label="Réduire la timeline" title="Réduire la timeline">⌄</button><strong>Timeline</strong><span id="frame-count">20 images</span></div><div class="timeline-mini-controls"><button type="button" id="timeline-prev" aria-label="Reculer d’une image">◀</button><button type="button" id="timeline-play" aria-label="Lire l’animation">▶</button><button type="button" id="timeline-next" aria-label="Avancer d’une image">▶|</button><label title="Zoom de la timeline"><input id="timeline-scale" type="range" min="42" max="100" value="52"></label></div><span class="scene-info">Scene 1 <span>24 fps</span></span></header>
        <div class="timeline-body"><div class="layer-column"><div class="layer-column-heading">Calques <button type="button" id="add-layer" title="Ajouter un calque" aria-label="Ajouter un calque">+</button></div><div id="layer-list"></div></div><div class="track-viewport"><div id="frame-ruler"></div><div id="layer-tracks"></div><div class="frame-commands"><button type="button" id="add-frame">＋ Add Drawing</button><button type="button" id="duplicate-frame">⧉ Duplicate</button><button type="button" id="extend-frame">↔ Extend</button><button type="button" id="delete-frame" aria-label="Supprimer l’image sélectionnée">⌫</button></div></div></div>
      </section>
      <div class="desk-action-menu" id="desk-action-menu" hidden><button type="button" id="menu-export-video">Exporter la vidéo…</button><button type="button" id="export-frame">Exporter l’image PNG</button><button type="button" id="menu-clear-frame">Effacer l’image courante</button></div>
      <p class="visually-hidden" id="animation-announcer" aria-live="polite"></p>
    </section>
    <section class="tool-view desk-projects-view" id="desk-projects-view" hidden aria-label="Animation Desk Projects">
      <header class="desk-topbar"><nav class="desk-tabs" aria-label="Navigation Projects"><button type="button" class="current">Projects</button><button type="button" id="desk-project-library">Library</button><button type="button" id="desk-project-animation">Animation Desk</button></nav><span class="desk-document-name">HEF Creative</span></header>
      <div class="desk-projects-main">
        <div class="desk-projects-heading"><h1>Projects</h1><div class="desk-projects-actions"><button type="button" id="desk-project-help">Help</button><label>Sort by <select id="desk-project-sort"><option value="updated">Last modified</option><option value="created">Date created</option><option value="name">Name</option></select></label><button type="button" id="desk-project-select" aria-pressed="false">Select</button><button type="button" id="desk-project-import">Import</button><button type="button" class="desk-project-add" id="desk-project-add" aria-label="Create animation clip" title="Create animation clip">+</button></div></div>
        <label class="desk-project-search"><span aria-hidden="true">⌕</span><input id="desk-project-search" type="search" placeholder="Search projects" aria-label="Search projects"></label>
        <div class="desk-project-grid" id="desk-project-grid" aria-live="polite"></div>
        <section class="desk-project-empty" id="desk-project-empty" hidden><span aria-hidden="true">▧</span><h2>No projects yet</h2><p>Créez une animation pour la retrouver ici.</p><button type="button" id="desk-project-empty-create">Create Animation Clip</button></section>
        <div class="desk-project-selection" id="desk-project-selection" hidden><span id="desk-project-selection-count">0 selected</span><button type="button" id="desk-project-export-selected">Export</button><button type="button" id="desk-project-delete-selected">Delete</button><button type="button" id="desk-project-selection-done">Done</button></div>
        <input class="visually-hidden" id="desk-project-import-file" type="file" accept=".hefclip,.json,application/json">
        <p class="desk-project-status" id="desk-project-status" role="status" aria-live="polite"></p>
      </div>
      <dialog class="desk-project-help-dialog" id="desk-project-help-dialog"><div class="library-preview-head"><h2>Animation Desk Projects</h2><button type="button" id="desk-project-help-close" aria-label="Close">×</button></div><p>Vos animations sont enregistrées dans ce navigateur. Créez un clip, dessinez, puis revenez ici pour le rouvrir ou l’exporter.</p><p>Utilisez Import pour charger un fichier HEF Clip au format JSON.</p></dialog>
    </section>
    <section class="tool-view library-view" id="library-view" hidden aria-label="Library">
      <header class="desk-topbar library-topbar"><nav class="desk-tabs" aria-label="Navigation Library"><button type="button" id="library-projects-tab">Projects</button><button type="button" class="current">Library</button><button type="button" id="library-animation-tab">Animation Desk</button></nav><span class="desk-document-name">HEF Creative</span></header>
      <div class="library-main">
        <div class="library-heading"><h1>Library</h1><div class="library-tabs" role="tablist" aria-label="Type de média"><button type="button" role="tab" data-library-type="clips" aria-selected="true">Animation Clips</button><button type="button" role="tab" data-library-type="videos" aria-selected="false">Videos</button><button type="button" role="tab" data-library-type="audio" aria-selected="false">Audio Clips</button></div><div class="library-actions"><label class="library-sort">Sort by <select id="library-sort"><option value="newest">Recently added</option><option value="oldest">Oldest first</option><option value="name">Name</option></select></label><button class="library-select" id="library-select" type="button" aria-pressed="false">Select</button><div class="library-add-wrap"><button class="library-add" id="library-add" type="button" aria-label="Ajouter" aria-expanded="false" aria-controls="library-add-menu" title="Ajouter">+</button><div class="library-add-menu" id="library-add-menu" hidden><button type="button" id="create-animation-clip"><span aria-hidden="true">＋</span>Create Animation Clip</button><button type="button" id="import-from-photos"><span aria-hidden="true">▧</span>Import from Photos</button><button type="button" id="import-from-files"><span aria-hidden="true">▰</span>Import from Files</button></div></div></div></div>
        <label class="library-search"><span aria-hidden="true">⌕</span><input id="library-search" type="search" placeholder="Search" aria-label="Rechercher dans Library"></label>
        <div class="library-grid" id="library-grid" aria-live="polite"></div>
        <section class="library-empty" id="library-empty" hidden><span aria-hidden="true">▧</span><h2>No media yet</h2><p>Ajoutez des clips, vidéos ou fichiers audio à votre bibliothèque.</p><button type="button" id="library-empty-add">Ajouter des fichiers</button></section>
        <div class="library-selection" id="library-selection" hidden><span id="library-selection-count">0 sélectionné</span><button type="button" id="library-delete-selected">Supprimer la sélection</button><button type="button" id="library-done-selecting">Terminé</button></div>
        <input class="visually-hidden" id="library-file-input" type="file" multiple>
        <input class="visually-hidden" id="library-photo-input" type="file" accept="image/*" multiple>
        <p class="library-status" id="library-status" role="status" aria-live="polite"></p>
      </div>
    </section>
    <dialog class="library-preview-dialog" id="library-preview-dialog" aria-labelledby="library-preview-title"><div class="library-preview-head"><h2 id="library-preview-title"></h2><button type="button" id="library-preview-close" aria-label="Fermer">×</button></div><div id="library-preview-content"></div><div class="library-preview-actions"><button type="button" class="library-use-image" id="library-use-image" hidden>Utiliser sur la scène</button><button type="button" id="library-preview-delete">Supprimer</button></div></dialog>`);

  const fpsSelect = doc.querySelector('#animation-fps');
  fpsSelect.parentElement.firstChild.textContent = '';
  fpsSelect.after(doc.createTextNode(' fps'));

  const projectNav = toolNav.querySelector('[data-view="projects"]');
  const views = {
    projects: projectView,
    addons: doc.querySelector('#addons-view'),
    animation: doc.querySelector('#animation-view'),
    library: doc.querySelector('#library-view'),
    deskProjects: doc.querySelector('#desk-projects-view')
  };
  const breadcrumb = main.querySelector('.topline > div');
  function activateView(name) {
    doc.body.classList.toggle('animation-open', name === 'animation' || name === 'library' || name === 'deskProjects');
    doc.body.classList.toggle('library-open', name === 'library');
    doc.body.classList.toggle('desk-projects-open', name === 'deskProjects');
    Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name; });
    toolNav.querySelectorAll('[data-view]').forEach(button => {
      if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const titles = { projects: 'Projets', addons: 'Création d’add-on', animation: 'Animation vidéo', library: 'Library', deskProjects: 'Animation Desk Projects' };
    if (breadcrumb) breadcrumb.innerHTML = `Studio <span>/</span> ${titles[name]}`;
    doc.title = `HEF Creative — ${titles[name]}`;
    if (name === 'library') renderLibrary();
    if (name === 'deskProjects') renderDeskProjects();
  }
  toolNav.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) activateView(button.dataset.view);
  });
  projectNav.addEventListener('click', () => activateView('projects'));
  doc.querySelector('#library-tab').addEventListener('click', () => activateView('library'));
  doc.querySelector('#library-projects-tab').addEventListener('click', goToDeskProjects);
  doc.querySelector('#library-animation-tab').addEventListener('click', () => activateView('animation'));
  doc.querySelector('#projects-tab').addEventListener('click', goToDeskProjects);
  doc.querySelector('#desk-project-library').addEventListener('click', () => activateView('library'));
  doc.querySelector('#desk-project-animation').addEventListener('click', () => currentProjectId ? loadDeskProject(currentProjectId) : createAnimationClip());

  const libraryGrid = doc.querySelector('#library-grid');
  const libraryStatus = doc.querySelector('#library-status');
  const libraryFileInput = doc.querySelector('#library-file-input');
  const libraryPhotoInput = doc.querySelector('#library-photo-input');
  const libraryAddMenu = doc.querySelector('#library-add-menu');
  const librarySelection = doc.querySelector('#library-selection');
  const librarySelectionCount = doc.querySelector('#library-selection-count');
  const libraryPreviewDialog = doc.querySelector('#library-preview-dialog');
  const deskProjectGrid = doc.querySelector('#desk-project-grid');
  const deskProjectStatus = doc.querySelector('#desk-project-status');
  const deskProjectImportInput = doc.querySelector('#desk-project-import-file');
  let libraryType = 'clips';
  let libraryItems = [];
  let librarySelectionMode = false;
  let selectedLibraryIds = new Set();
  let libraryDatabasePromise;
  let libraryObjectUrls = [];
  let previewObjectUrl = null;
  let previewAsset = null;
  let deskProjectSelectionMode = false;
  let selectedDeskProjectIds = new Set();
  let deskProjectObjectUrls = [];
  let currentProjectId = null;
  let currentProjectName = 'Untitled Clip';
  let currentProjectCreatedAt = Date.now();
  let projectSaveTimer = null;

  function openLibraryDatabase() {
    if (!global.indexedDB) return Promise.reject(new Error('IndexedDB indisponible dans ce navigateur.'));
    if (libraryDatabasePromise) return libraryDatabasePromise;
    libraryDatabasePromise = new Promise((resolve, reject) => {
      const request = global.indexedDB.open('hef-creative-library', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('assets')) request.result.createObjectStore('assets', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return libraryDatabasePromise;
  }
  function libraryRequest(mode, operation) {
    return openLibraryDatabase().then(database => new Promise((resolve, reject) => {
      const transaction = database.transaction('assets', mode);
      let request;
      try { request = operation(transaction.objectStore('assets')); }
      catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    }));
  }
  const getLibraryAssets = () => libraryRequest('readonly', store => store.getAll());
  const saveLibraryAsset = asset => libraryRequest('readwrite', store => store.put(asset));
  const removeLibraryAsset = id => libraryRequest('readwrite', store => store.delete(id));
  function libraryAccept(type) {
    return type === 'audio' ? 'audio/*' : type === 'videos' ? 'video/*' : 'video/*,image/gif,image/png,image/jpeg,image/webp';
  }
  libraryFileInput.accept = libraryAccept(libraryType);
  function clearLibraryUrls() {
    libraryObjectUrls.forEach(url => URL.revokeObjectURL(url));
    libraryObjectUrls = [];
  }
  function setLibraryType(type) {
    libraryType = type;
    selectedLibraryIds.clear();
    doc.querySelectorAll('[data-library-type]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.libraryType === type)));
    libraryFileInput.accept = libraryAccept(type);
    renderLibrary();
  }
  function updateLibrarySelection() {
    librarySelection.hidden = !librarySelectionMode;
    librarySelectionCount.textContent = `${selectedLibraryIds.size} sélectionné${selectedLibraryIds.size === 1 ? '' : 's'}`;
    doc.querySelector('#library-select').textContent = librarySelectionMode ? 'Cancel' : 'Select';
    doc.querySelector('#library-select').setAttribute('aria-pressed', String(librarySelectionMode));
    doc.querySelector('#library-delete-selected').disabled = selectedLibraryIds.size === 0;
  }
  async function renderLibrary() {
    clearLibraryUrls();
    libraryGrid.replaceChildren();
    try { libraryItems = await getLibraryAssets(); }
    catch (error) {
      libraryStatus.textContent = `La bibliothèque locale n’est pas disponible : ${error.message}`;
      doc.querySelector('#library-empty').hidden = false;
      return;
    }
    const query = doc.querySelector('#library-search').value.trim().toLocaleLowerCase();
    const sort = doc.querySelector('#library-sort').value;
    const filtered = libraryItems.filter(item => item.kind === libraryType && item.name.toLocaleLowerCase().includes(query));
    filtered.sort((first, second) => sort === 'name' ? first.name.localeCompare(second.name) : sort === 'oldest' ? first.createdAt - second.createdAt : second.createdAt - first.createdAt);
    doc.querySelector('#library-empty').hidden = filtered.length > 0;
    libraryStatus.textContent = filtered.length ? `${filtered.length} élément${filtered.length === 1 ? '' : 's'}` : '';
    filtered.forEach(item => {
      const card = doc.createElement('article');
      card.className = `library-entry${selectedLibraryIds.has(item.id) ? ' is-selected' : ''}`;
      const previewButton = doc.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'library-entry-preview';
      previewButton.setAttribute('aria-label', `Aperçu : ${item.name}`);
      const media = doc.createElement('div');
      media.className = 'library-entry-media';
      const url = URL.createObjectURL(item.blob);
      libraryObjectUrls.push(url);
      if (item.mimeType.startsWith('image/')) {
        const image = doc.createElement('img');
        image.src = url;
        image.alt = '';
        media.append(image);
      } else {
        const glyph = doc.createElement('span');
        glyph.className = 'library-media-glyph';
        glyph.textContent = item.kind === 'audio' ? '♫' : '▶';
        media.append(glyph);
        if (item.kind === 'clips' || item.kind === 'videos') {
          const video = doc.createElement('video');
          video.src = url;
          video.muted = true;
          video.preload = 'metadata';
          media.append(video);
        }
      }
      const details = doc.createElement('span');
      details.className = 'library-entry-details';
      const title = doc.createElement('strong');
      title.textContent = item.name;
      const meta = doc.createElement('small');
      meta.textContent = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(item.createdAt);
      details.append(title, meta);
      previewButton.append(media, details);
      previewButton.addEventListener('click', () => {
        if (librarySelectionMode) {
          if (selectedLibraryIds.has(item.id)) selectedLibraryIds.delete(item.id);
          else selectedLibraryIds.add(item.id);
          renderLibrary();
          updateLibrarySelection();
        } else openLibraryPreview(item);
      });
      card.append(previewButton);
      if (librarySelectionMode) {
        const checkbox = doc.createElement('input');
        checkbox.className = 'library-entry-check';
        checkbox.type = 'checkbox';
        checkbox.checked = selectedLibraryIds.has(item.id);
        checkbox.setAttribute('aria-label', `Sélectionner ${item.name}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedLibraryIds.add(item.id);
          else selectedLibraryIds.delete(item.id);
          card.classList.toggle('is-selected', checkbox.checked);
          updateLibrarySelection();
        });
        card.append(checkbox);
      }
      libraryGrid.append(card);
    });
    updateLibrarySelection();
  }
  function openLibraryPreview(item) {
    previewAsset = item;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(item.blob);
    const content = doc.querySelector('#library-preview-content');
    content.replaceChildren();
    doc.querySelector('#library-preview-title').textContent = item.name;
    const media = doc.createElement(item.mimeType.startsWith('audio/') ? 'audio' : item.mimeType.startsWith('video/') ? 'video' : 'img');
    media.src = previewObjectUrl;
    if (media.tagName === 'IMG') media.alt = item.name;
    else { media.controls = true; media.autoplay = false; }
    content.append(media);
    doc.querySelector('#library-use-image').hidden = !item.mimeType.startsWith('image/');
    libraryPreviewDialog.showModal();
  }
  async function addLibraryFiles(files, targetType = libraryType) {
    const fileList = [...files];
    if (!fileList.length) return;
    libraryStatus.textContent = 'Ajout des fichiers…';
    try {
      for (const file of fileList) {
        const expected = targetType === 'audio' ? file.type.startsWith('audio/') : targetType === 'videos' ? file.type.startsWith('video/') : file.type.startsWith('video/') || file.type.startsWith('image/');
        if (!expected) continue;
        await saveLibraryAsset({ id: uuid(), kind: targetType, name: file.name, mimeType: file.type || 'application/octet-stream', blob: file, createdAt: Date.now() });
      }
      libraryStatus.textContent = 'Fichiers ajoutés à la bibliothèque.';
      if (targetType !== libraryType) setLibraryType(targetType);
      else await renderLibrary();
    } catch (error) {
      libraryStatus.textContent = `Impossible d’enregistrer les fichiers : ${error.message}`;
    } finally {
      libraryFileInput.value = '';
    }
  }
  function closeLibraryAddMenu() {
    libraryAddMenu.hidden = true;
    doc.querySelector('#library-add').setAttribute('aria-expanded', 'false');
  }
  doc.querySelector('#library-add').addEventListener('click', () => {
    libraryAddMenu.hidden = !libraryAddMenu.hidden;
    doc.querySelector('#library-add').setAttribute('aria-expanded', String(!libraryAddMenu.hidden));
  });
  doc.addEventListener('pointerdown', event => {
    if (!event.target.closest('.library-add-wrap')) closeLibraryAddMenu();
  });
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') closeLibraryAddMenu(); });
  doc.querySelector('#create-animation-clip').addEventListener('click', () => {
    closeLibraryAddMenu();
    createAnimationClip();
  });
  doc.querySelector('#import-from-photos').addEventListener('click', () => {
    closeLibraryAddMenu();
    libraryPhotoInput.click();
  });
  doc.querySelector('#import-from-files').addEventListener('click', () => {
    closeLibraryAddMenu();
    libraryFileInput.accept = libraryAccept(libraryType);
    libraryFileInput.click();
  });
  libraryPhotoInput.addEventListener('change', event => addLibraryFiles(event.target.files, 'clips'));
  async function deleteLibraryItem(id) {
    await removeLibraryAsset(id);
    selectedLibraryIds.delete(id);
    if (previewAsset?.id === id) libraryPreviewDialog.close();
    await renderLibrary();
  }
  function clearDeskProjectUrls() {
    deskProjectObjectUrls.forEach(url => URL.revokeObjectURL(url));
    deskProjectObjectUrls = [];
  }
  function updateDeskProjectSelection() {
    const selection = doc.querySelector('#desk-project-selection');
    selection.hidden = !deskProjectSelectionMode;
    doc.querySelector('#desk-project-selection-count').textContent = `${selectedDeskProjectIds.size} selected`;
    const selectButton = doc.querySelector('#desk-project-select');
    selectButton.textContent = deskProjectSelectionMode ? 'Cancel' : 'Select';
    selectButton.setAttribute('aria-pressed', String(deskProjectSelectionMode));
    doc.querySelector('#desk-project-export-selected').disabled = selectedDeskProjectIds.size !== 1;
    doc.querySelector('#desk-project-delete-selected').disabled = selectedDeskProjectIds.size === 0;
  }
  async function renderDeskProjects() {
    clearDeskProjectUrls();
    deskProjectGrid.replaceChildren();
    let projects;
    try { projects = (await getLibraryAssets()).filter(item => item.kind === 'desk-project'); }
    catch (error) {
      deskProjectStatus.textContent = `Projects storage is unavailable: ${error.message}`;
      doc.querySelector('#desk-project-empty').hidden = false;
      return;
    }
    const query = doc.querySelector('#desk-project-search').value.trim().toLocaleLowerCase();
    const sort = doc.querySelector('#desk-project-sort').value;
    projects = projects.filter(project => project.name.toLocaleLowerCase().includes(query));
    projects.sort((first, second) => sort === 'name' ? first.name.localeCompare(second.name) : sort === 'created' ? first.createdAt - second.createdAt : second.updatedAt - first.updatedAt);
    const empty = doc.querySelector('#desk-project-empty');
    empty.hidden = projects.length > 0;
    empty.querySelector('h2').textContent = query ? 'No projects found' : 'No projects yet';
    empty.querySelector('p').textContent = query ? 'Essayez un autre nom de projet.' : 'Créez une animation pour la retrouver ici.';
    doc.querySelector('#desk-project-empty-create').hidden = Boolean(query);
    deskProjectStatus.textContent = projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : '';
    projects.forEach(project => {
      const card = doc.createElement('article');
      card.className = `desk-project-card${selectedDeskProjectIds.has(project.id) ? ' is-selected' : ''}`;
      const open = doc.createElement('button');
      open.type = 'button';
      open.className = 'desk-project-card-open';
      open.setAttribute('aria-label', `Open ${project.name}`);
      const preview = doc.createElement('div');
      preview.className = 'desk-project-preview';
      if (project.preview instanceof Blob) {
        const image = doc.createElement('img');
        image.src = URL.createObjectURL(project.preview);
        image.alt = '';
        deskProjectObjectUrls.push(image.src);
        preview.append(image);
      } else {
        const label = doc.createElement('span');
        label.textContent = '▶';
        preview.append(label);
      }
      const details = doc.createElement('span');
      details.className = 'desk-project-details';
      const title = doc.createElement('strong');
      title.textContent = project.name;
      const metadata = doc.createElement('small');
      metadata.textContent = `${project.width || 640} × ${project.height || 400} px · ${project.fps || 24} fps`;
      details.append(title, metadata);
      open.append(preview, details);
      open.addEventListener('click', () => {
        if (deskProjectSelectionMode) {
          if (selectedDeskProjectIds.has(project.id)) selectedDeskProjectIds.delete(project.id);
          else selectedDeskProjectIds.add(project.id);
          renderDeskProjects();
        } else loadDeskProject(project.id);
      });
      card.append(open);
      if (deskProjectSelectionMode) {
        const checkbox = doc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'desk-project-check';
        checkbox.checked = selectedDeskProjectIds.has(project.id);
        checkbox.setAttribute('aria-label', `Select ${project.name}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedDeskProjectIds.add(project.id);
          else selectedDeskProjectIds.delete(project.id);
          card.classList.toggle('is-selected', checkbox.checked);
          updateDeskProjectSelection();
        });
        card.append(checkbox);
      }
      deskProjectGrid.append(card);
    });
    updateDeskProjectSelection();
  }
  doc.querySelector('#desk-project-add').addEventListener('click', () => createAnimationClip());
  doc.querySelector('#desk-project-empty-create').addEventListener('click', () => createAnimationClip());
  doc.querySelector('#desk-project-help').addEventListener('click', () => doc.querySelector('#desk-project-help-dialog').showModal());
  doc.querySelector('#desk-project-help-close').addEventListener('click', () => doc.querySelector('#desk-project-help-dialog').close());
  doc.querySelector('#desk-project-select').addEventListener('click', () => {
    deskProjectSelectionMode = !deskProjectSelectionMode;
    selectedDeskProjectIds.clear();
    renderDeskProjects();
  });
  doc.querySelector('#desk-project-selection-done').addEventListener('click', () => {
    deskProjectSelectionMode = false;
    selectedDeskProjectIds.clear();
    renderDeskProjects();
  });
  doc.querySelector('#desk-project-search').addEventListener('input', renderDeskProjects);
  doc.querySelector('#desk-project-sort').addEventListener('change', renderDeskProjects);
  doc.querySelector('#desk-project-export-selected').addEventListener('click', async () => {
    if (selectedDeskProjectIds.size !== 1) return;
    const project = (await getLibraryAssets()).find(item => item.id === [...selectedDeskProjectIds][0]);
    if (project) downloadDeskProject(project);
  });
  doc.querySelector('#desk-project-delete-selected').addEventListener('click', async () => {
    const removedCurrentProject = selectedDeskProjectIds.has(currentProjectId);
    for (const id of selectedDeskProjectIds) await removeLibraryAsset(id);
    if (removedCurrentProject) {
      currentProjectId = null;
      currentProjectName = 'Untitled Clip';
      currentProjectCreatedAt = Date.now();
    }
    selectedDeskProjectIds.clear();
    await renderDeskProjects();
  });
  doc.querySelector('#desk-project-import').addEventListener('click', () => deskProjectImportInput.click());
  deskProjectImportInput.addEventListener('change', importDeskProjectFile);
  doc.querySelectorAll('[data-library-type]').forEach(tab => tab.addEventListener('click', () => setLibraryType(tab.dataset.libraryType)));
  doc.querySelector('#library-empty-add').addEventListener('click', () => {
    libraryAddMenu.hidden = false;
    doc.querySelector('#library-add').setAttribute('aria-expanded', 'true');
  });
  libraryFileInput.addEventListener('change', event => addLibraryFiles(event.target.files));
  doc.querySelector('#library-search').addEventListener('input', renderLibrary);
  doc.querySelector('#library-sort').addEventListener('change', renderLibrary);
  doc.querySelector('#library-select').addEventListener('click', () => {
    librarySelectionMode = !librarySelectionMode;
    selectedLibraryIds.clear();
    updateLibrarySelection();
    renderLibrary();
  });
  doc.querySelector('#library-done-selecting').addEventListener('click', () => {
    librarySelectionMode = false;
    selectedLibraryIds.clear();
    updateLibrarySelection();
    renderLibrary();
  });
  doc.querySelector('#library-delete-selected').addEventListener('click', async () => {
    const ids = [...selectedLibraryIds];
    for (const id of ids) await removeLibraryAsset(id);
    selectedLibraryIds.clear();
    await renderLibrary();
  });
  doc.querySelector('#library-preview-close').addEventListener('click', () => libraryPreviewDialog.close());
  libraryPreviewDialog.addEventListener('close', () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    previewAsset = null;
  });
  doc.querySelector('#library-preview-delete').addEventListener('click', async () => {
    if (previewAsset) await deleteLibraryItem(previewAsset.id);
  });
  doc.querySelector('#library-use-image').addEventListener('click', async () => {
    if (!previewAsset || !previewAsset.mimeType.startsWith('image/')) return;
    const bitmap = await createImageBitmap(previewAsset.blob);
    activateView('animation');
    rememberForUndo();
    draftContext.clearRect(0, 0, frameWidth, frameHeight);
    const scale = Math.min(frameWidth / bitmap.width, frameHeight / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    draftContext.drawImage(bitmap, (frameWidth - width) / 2, (frameHeight - height) / 2, width, height);
    bitmap.close();
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    libraryPreviewDialog.close();
  });

  const slugify = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'nouvel_objet';
  const addonCanvas = doc.querySelector('#addon-preview');
  const addonContext = addonCanvas.getContext('2d');
  const addonColor = doc.querySelector('#addon-color');
  const addonName = doc.querySelector('#addon-name');
  const addonId = doc.querySelector('#addon-id');
  const addonForm = doc.querySelector('#addon-form');
  let importedTexture = null;

  function hexToRgb(hex) { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }
  function shade(hex, factor) { return `rgb(${hexToRgb(hex).map(channel => Math.max(0, Math.min(255, Math.round(channel * factor)))).join(' ')})`; }
  function drawGem() {
    addonContext.clearRect(0, 0, 16, 16);
    const color = addonColor.value;
    for (let y = 1; y < 15; y += 1) {
      for (let x = 1; x < 15; x += 1) {
        const distance = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        if (distance <= 7) addonContext.fillStyle = distance > 5.5 ? shade(color, 0.6) : (x + y < 13 ? shade(color, 1.35) : color);
        else continue;
        addonContext.fillRect(x, y, 1, 1);
      }
    }
    doc.querySelector('#addon-preview-name').textContent = addonName.value || 'Votre objet';
    doc.querySelector('#addon-preview-id').textContent = `hefcreative:${addonId.value || 'nouvel_objet'}`;
  }
  addonName.addEventListener('input', () => {
    if (!addonId.dataset.edited) addonId.value = slugify(addonName.value);
    if (!importedTexture) drawGem();
    else {
      doc.querySelector('#addon-preview-name').textContent = addonName.value || 'Votre objet';
      doc.querySelector('#addon-preview-id').textContent = `hefcreative:${addonId.value || 'nouvel_objet'}`;
    }
  });
  addonId.addEventListener('input', () => {
    addonId.dataset.edited = 'true';
    if (!importedTexture) drawGem();
    else doc.querySelector('#addon-preview-id').textContent = `hefcreative:${addonId.value || 'nouvel_objet'}`;
  });
  addonColor.addEventListener('input', () => { importedTexture = null; drawGem(); });
  doc.querySelector('#addon-texture').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      addonContext.clearRect(0, 0, 16, 16);
      addonContext.imageSmoothingEnabled = false;
      addonContext.drawImage(bitmap, 0, 0, 16, 16);
      bitmap.close();
      importedTexture = addonCanvas.toDataURL('image/png');
      doc.querySelector('#addon-status').textContent = `Texture « ${file.name} » prête à être intégrée au pack.`;
    } catch {
      doc.querySelector('#addon-status').textContent = 'Cette image n’a pas pu être chargée. Choisissez un autre fichier.';
    }
  });

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      return (char === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  }
  function downloadFile(data, filename, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function canvasPng(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer))) : reject(new Error('Texture PNG indisponible.')), 'image/png'));
  }
  function jsonFile(value) { return JSON.stringify(value, null, 2); }
  addonForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!addonForm.reportValidity()) return;
    const button = addonForm.querySelector('[type="submit"]');
    const status = doc.querySelector('#addon-status');
    button.disabled = true;
    status.textContent = 'Préparation de votre pack Minecraft…';
    try {
      const displayName = addonName.value.trim();
      const itemId = slugify(addonId.value);
      const resourceUuid = uuid();
      const behaviorUuid = uuid();
      const version = [1, 0, 0];
      const textureBytes = importedTexture
        ? new Uint8Array(await (await fetch(importedTexture)).arrayBuffer())
        : await canvasPng(addonCanvas);
      const resourcePack = {
        format_version: 2,
        header: { name: `${displayName} — Ressources`, description: 'Texture créée avec HEF Creative', uuid: resourceUuid, version, min_engine_version: [1, 20, 0] },
        modules: [{ description: 'Textures et atlas de l’objet', type: 'resources', uuid: uuid(), version }]
      };
      const behaviorPack = {
        format_version: 2,
        header: { name: `${displayName} — Comportement`, description: 'Objet créé avec HEF Creative', uuid: behaviorUuid, version, min_engine_version: [1, 20, 0] },
        modules: [{ description: 'Définition de l’objet', type: 'data', uuid: uuid(), version }],
        dependencies: [{ uuid: resourceUuid, version }]
      };
      const item = {
        format_version: '1.20.80',
        'minecraft:item': {
          description: { identifier: `hefcreative:${itemId}`, menu_category: { category: 'items' } },
          components: {
            'minecraft:display_name': { value: displayName },
            'minecraft:icon': itemId,
            'minecraft:max_stack_size': Number(doc.querySelector('#addon-stack').value),
            'minecraft:hand_equipped': doc.querySelector('#addon-hand').checked
          }
        }
      };
      const textureAtlas = {
        resource_pack_name: displayName,
        texture_name: 'atlas.items',
        texture_data: { [itemId]: { textures: `textures/items/${itemId}` } }
      };
      const baseName = slugify(displayName);
      const archive = createZip([
        { name: `${baseName}_BP/manifest.json`, content: jsonFile(behaviorPack) },
        { name: `${baseName}_BP/items/${itemId}.json`, content: jsonFile(item) },
        { name: `${baseName}_RP/manifest.json`, content: jsonFile(resourcePack) },
        { name: `${baseName}_RP/textures/item_texture.json`, content: jsonFile(textureAtlas) },
        { name: `${baseName}_RP/textures/items/${itemId}.png`, content: textureBytes },
        { name: 'README.txt', content: 'Ouvrez ce fichier .mcaddon avec Minecraft Bedrock pour importer les packs. Activez le pack de comportement et le pack de ressources dans les paramètres de votre monde.' }
      ]);
      downloadFile(archive, `${baseName}.mcaddon`, 'application/zip');
      status.textContent = `${displayName}.mcaddon est prêt. Ouvrez-le avec Minecraft Bedrock pour importer votre objet.`;
    } catch (error) {
      console.error(error);
      status.textContent = 'L’export a échoué. Vérifiez que le navigateur autorise les téléchargements et réessayez.';
    } finally {
      button.disabled = false;
    }
  });
  addonForm.addEventListener('input', () => { if (!importedTexture) drawGem(); });
  drawGem();

  const canvas = doc.querySelector('#drawing-canvas');
  const context = canvas.getContext('2d');
  const ghostCanvas = doc.createElement('canvas');
  ghostCanvas.width = canvas.width;
  ghostCanvas.height = canvas.height;
  const ghostContext = ghostCanvas.getContext('2d');
  const draftCanvas = doc.createElement('canvas');
  draftCanvas.width = canvas.width;
  draftCanvas.height = canvas.height;
  const draftContext = draftCanvas.getContext('2d');
  const onionToggle = doc.querySelector('#onion-skin');
  const frameWidth = canvas.width;
  const frameHeight = canvas.height;
  const ruler = doc.querySelector('#frame-ruler');
  const layerList = doc.querySelector('#layer-list');
  const layerTracks = doc.querySelector('#layer-tracks');
  const timelineViewport = doc.querySelector('.track-viewport');
  const layerCell = () => Array(20).fill(null);
  let frameCount = 20;
  let layers = [
    { id: 'background', name: 'Background', visible: true, locked: true, frames: layerCell() },
    { id: 'bg', name: 'BG', visible: true, locked: false, frames: layerCell() },
    { id: 'layer-2', name: 'Layer 2', visible: true, locked: false, frames: layerCell() }
  ];
  let activeLayerId = 'layer-2';
  let undoStacks = Array.from({ length: frameCount }, () => []);
  let activeFrame = 0;
  let drawing = false;
  let activeTool = 'brush';
  let playbackTimer = null;
  let playbackIndex = 0;
  let recording = false;
  let paintStart = null;

  function currentProjectRecord(preview = null) {
    saveActiveFrame();
    return {
      id: currentProjectId || (currentProjectId = uuid()),
      kind: 'desk-project',
      name: currentProjectName,
      createdAt: currentProjectCreatedAt,
      updatedAt: Date.now(),
      width: frameWidth,
      height: frameHeight,
      fps: Number(doc.querySelector('#animation-fps').value),
      frameCount,
      activeLayerId,
      layers: layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        frames: layer.frames.slice(0, frameCount).map(frame => frame ? new Uint8ClampedArray(frame.data) : null)
      })),
      preview
    };
  }
  async function saveCurrentProject() {
    clearTimeout(projectSaveTimer);
    if (playbackTimer) stopPlayback();
    paintFrame(activeFrame, false);
    const preview = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    paintFrame(activeFrame);
    const project = currentProjectRecord(preview);
    await saveLibraryAsset(project);
    currentProjectCreatedAt = project.createdAt;
    return project;
  }
  function scheduleProjectSave() {
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => {
      saveCurrentProject().catch(error => {
        deskProjectStatus.textContent = `Autosave unavailable: ${error.message}`;
      });
    }, 450);
  }
  function goToDeskProjects() {
    saveCurrentProject()
      .catch(error => { deskProjectStatus.textContent = `Project could not be saved: ${error.message}`; })
      .finally(() => activateView('deskProjects'));
  }
  function createAnimationClip() {
    const requestedName = global.prompt('Nom du projet Animation Desk', 'Untitled Clip');
    if (requestedName === null) return;
    const name = requestedName.trim() || 'Untitled Clip';
    const start = async () => {
      if (currentProjectId) await saveCurrentProject();
      if (playbackTimer) stopPlayback();
      currentProjectId = uuid();
      currentProjectName = name;
      currentProjectCreatedAt = Date.now();
      frameCount = 1;
      layers.forEach(layer => {
        layer.frames = [null];
        layer.visible = true;
      });
      undoStacks = [[]];
      activeFrame = 0;
      activeLayerId = 'layer-2';
      draftContext.clearRect(0, 0, frameWidth, frameHeight);
      loadDraft();
      doc.querySelector('.desk-document-name').firstChild.textContent = name;
      doc.querySelector('#animation-status').textContent = 'Nouveau clip prêt à dessiner.';
      activateView('animation');
      refreshTimeline();
      paintFrame(activeFrame);
      await saveCurrentProject();
    };
    start().catch(error => { deskProjectStatus.textContent = `Le projet n’a pas pu être créé : ${error.message}`; });
  }
  function encodePixels(pixels) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < pixels.length; offset += chunkSize) binary += String.fromCharCode(...pixels.subarray(offset, offset + chunkSize));
    return global.btoa(binary);
  }
  function decodePixels(encoded) {
    const binary = global.atob(encoded);
    if (binary.length !== frameWidth * frameHeight * 4) throw new Error('La taille d’image du clip est invalide.');
    const pixels = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) pixels[index] = binary.charCodeAt(index);
    return pixels;
  }
  function downloadDeskProject(project) {
    const portable = {
      format: 'hef-creative-clip',
      version: 1,
      name: project.name,
      width: project.width,
      height: project.height,
      fps: project.fps,
      frameCount: project.frameCount,
      activeLayerId: project.activeLayerId,
      layers: project.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        frames: layer.frames.map(frame => frame ? encodePixels(frame instanceof Uint8ClampedArray ? frame : frame.data) : null)
      }))
    };
    downloadFile(JSON.stringify(portable), `${slugify(project.name)}.hefclip`, 'application/json');
  }
  async function importDeskProjectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const portable = JSON.parse(await file.text());
      if (portable.format !== 'hef-creative-clip' || portable.version !== 1 || !Array.isArray(portable.layers)) throw new Error('Choisissez un fichier HEF Clip valide.');
      const count = Math.max(1, Math.min(240, Number(portable.frameCount) || 1));
      const importedLayers = portable.layers.slice(0, 30).map(layer => ({
        id: String(layer.id || uuid()),
        name: String(layer.name || 'Layer'),
        visible: layer.visible !== false,
        locked: Boolean(layer.locked),
        frames: Array.from({ length: count }, (_, index) => layer.frames?.[index] ? decodePixels(layer.frames[index]) : null)
      }));
      const project = {
        id: uuid(), kind: 'desk-project', name: String(portable.name || file.name.replace(/\.(hefclip|json)$/i, '')),
        createdAt: Date.now(), updatedAt: Date.now(), width: frameWidth, height: frameHeight,
        fps: Number(portable.fps) || 24, frameCount: count,
        activeLayerId: importedLayers.find(layer => layer.id === portable.activeLayerId && !layer.locked)?.id || importedLayers.find(layer => !layer.locked)?.id,
        layers: importedLayers, preview: null
      };
      if (!project.layers.length) throw new Error('Le clip ne contient aucun calque.');
      await saveLibraryAsset(project);
      deskProjectStatus.textContent = `${project.name} importé.`;
      await renderDeskProjects();
    } catch (error) {
      deskProjectStatus.textContent = `Import impossible : ${error.message}`;
    } finally {
      deskProjectImportInput.value = '';
    }
  }
  async function loadDeskProject(id) {
    if (currentProjectId && currentProjectId !== id) await saveCurrentProject();
    const project = (await getLibraryAssets()).find(item => item.id === id && item.kind === 'desk-project');
    if (!project) { deskProjectStatus.textContent = 'Projet introuvable.'; return; }
    frameCount = Math.max(1, Number(project.frameCount) || 1);
    layers = project.layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      frames: Array.from({ length: frameCount }, (_, index) => {
        const pixels = layer.frames[index];
        if (!pixels) return null;
        const data = context.createImageData(frameWidth, frameHeight);
        data.data.set(pixels instanceof Uint8ClampedArray ? pixels : pixels.data);
        return data;
      })
    }));
    currentProjectId = project.id;
    currentProjectName = project.name;
    currentProjectCreatedAt = project.createdAt;
    activeLayerId = layers.find(layer => layer.id === project.activeLayerId && !layer.locked)?.id || layers.find(layer => !layer.locked)?.id;
    activeFrame = 0;
    undoStacks = Array.from({ length: frameCount }, () => []);
    doc.querySelector('#animation-fps').value = String(project.fps || 24);
    doc.querySelector('.desk-document-name').firstChild.textContent = currentProjectName;
    loadDraft();
    activateView('animation');
    refreshTimeline();
    paintFrame(activeFrame);
    doc.querySelector('#animation-status').textContent = 'Projet ouvert.';
  }

  function activeLayer() { return layers.find(layer => layer.id === activeLayerId); }
  function cloneImageData(imageData) {
    const copy = context.createImageData(frameWidth, frameHeight);
    if (imageData) copy.data.set(imageData.data);
    return copy;
  }
  function putLayer(target, data, alpha = 1) {
    if (!data) return;
    ghostContext.clearRect(0, 0, frameWidth, frameHeight);
    ghostContext.putImageData(data, 0, 0);
    target.save();
    target.globalAlpha = alpha;
    target.drawImage(ghostCanvas, 0, 0);
    target.restore();
  }
  function paintFrame(index, onionSkin = onionToggle.checked, target = context) {
    target.clearRect(0, 0, frameWidth, frameHeight);
    const background = layers.find(layer => layer.id === 'background');
    if (background?.visible) {
      target.fillStyle = '#ffffff';
      target.fillRect(0, 0, frameWidth, frameHeight);
    }
    if (onionSkin && index > 0) {
      layers.filter(layer => layer.visible && !layer.locked).forEach(layer => putLayer(target, layer.frames[index - 1], 0.16));
    }
    layers.filter(layer => layer.visible && !layer.locked).forEach(layer => {
      const data = layer.id === activeLayerId && index === activeFrame ? draftContext.getImageData(0, 0, frameWidth, frameHeight) : layer.frames[index];
      putLayer(target, data);
    });
  }
  function loadDraft() {
    draftContext.clearRect(0, 0, frameWidth, frameHeight);
    const data = activeLayer()?.frames[activeFrame];
    if (data) draftContext.putImageData(data, 0, 0);
  }
  function saveActiveFrame() {
    const layer = activeLayer();
    if (layer && !layer.locked) layer.frames[activeFrame] = draftContext.getImageData(0, 0, frameWidth, frameHeight);
  }
  function refreshTimeline() {
    const cellWidth = Number(doc.querySelector('#timeline-scale').value);
    timelineViewport.style.setProperty('--cell-width', `${cellWidth}px`);
    ruler.replaceChildren();
    ruler.style.gridTemplateColumns = `repeat(${frameCount}, var(--cell-width))`;
    for (let index = 0; index < frameCount; index += 1) {
      const tick = doc.createElement('button');
      tick.type = 'button';
      tick.className = 'ruler-tick';
      tick.textContent = String(index + 1);
      tick.setAttribute('aria-pressed', String(index === activeFrame));
      tick.addEventListener('click', () => selectFrame(index));
      ruler.append(tick);
    }
    layerList.replaceChildren();
    layerTracks.replaceChildren();
    const columns = `repeat(${frameCount}, var(--cell-width))`;
    layerTracks.style.setProperty('--timeline-columns', columns);
    layers.forEach(layer => {
      const label = doc.createElement('div');
      label.className = `layer-label${layer.id === activeLayerId ? ' is-active' : ''}`;
      const choose = doc.createElement('button');
      choose.type = 'button';
      choose.className = 'layer-name';
      choose.textContent = layer.name;
      choose.disabled = layer.locked;
      choose.addEventListener('click', () => {
        saveActiveFrame();
        activeLayerId = layer.id;
        loadDraft();
        paintFrame(activeFrame);
        refreshTimeline();
        scheduleProjectSave();
      });
      const visibility = doc.createElement('button');
      visibility.type = 'button';
      visibility.className = 'layer-visibility';
      visibility.textContent = layer.visible ? '◉' : '○';
      visibility.title = layer.visible ? 'Masquer le calque' : 'Afficher le calque';
      visibility.setAttribute('aria-label', visibility.title);
      visibility.addEventListener('click', () => {
        saveActiveFrame();
        layer.visible = !layer.visible;
        paintFrame(activeFrame);
        refreshTimeline();
        scheduleProjectSave();
      });
      label.append(choose, visibility);
      if (!layer.locked) {
        const removeLayer = doc.createElement('button');
        removeLayer.type = 'button';
        removeLayer.className = 'layer-remove';
        removeLayer.textContent = '×';
        removeLayer.title = 'Supprimer le calque';
        removeLayer.setAttribute('aria-label', `Supprimer ${layer.name}`);
        removeLayer.addEventListener('click', () => {
          if (layers.filter(item => !item.locked).length < 2) return;
          layers = layers.filter(item => item.id !== layer.id);
          if (activeLayerId === layer.id) activeLayerId = layers.find(item => !item.locked).id;
          loadDraft();
          paintFrame(activeFrame);
          refreshTimeline();
          scheduleProjectSave();
        });
        label.append(removeLayer);
      }
      layerList.append(label);

      const track = doc.createElement('div');
      track.className = `layer-track${layer.locked ? ' background-track' : ''}`;
      track.style.gridTemplateColumns = columns;
      for (let index = 0; index < frameCount; index += 1) {
        const cell = doc.createElement('button');
        cell.type = 'button';
        cell.className = `timeline-cell${index === activeFrame ? ' is-current' : ''}${layer.frames[index] ? ' has-drawing' : ''}`;
        cell.setAttribute('aria-label', `${layer.name}, image ${index + 1}`);
        cell.setAttribute('aria-pressed', String(index === activeFrame));
        if (layer.frames[index]) {
          const thumb = doc.createElement('canvas');
          thumb.width = 48;
          thumb.height = 30;
          thumb.setAttribute('aria-hidden', 'true');
          ghostContext.clearRect(0, 0, frameWidth, frameHeight);
          ghostContext.putImageData(layer.frames[index], 0, 0);
          thumb.getContext('2d').drawImage(ghostCanvas, 0, 0, thumb.width, thumb.height);
          cell.append(thumb);
        }
        cell.addEventListener('click', () => selectFrame(index));
        track.append(cell);
      }
      layerTracks.append(track);
    });
    doc.querySelector('#frame-count').textContent = `${activeFrame + 1} / ${frameCount}`;
  }
  function selectFrame(index) {
    if (playbackTimer) stopPlayback();
    saveActiveFrame();
    activeFrame = index;
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * frameWidth / rect.width, y: (event.clientY - rect.top) * frameHeight / rect.height };
  }
  function rememberForUndo() {
    const stack = undoStacks[activeFrame];
    stack.push(cloneImageData(draftContext.getImageData(0, 0, frameWidth, frameHeight)));
    if (stack.length > 30) stack.shift();
  }
  function finishStroke() {
    if (!drawing) return;
    drawing = false;
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  }
  canvas.addEventListener('pointerdown', event => {
    if (recording || playbackTimer || activeLayer()?.locked) return;
    const location = point(event);
    if (activeTool === 'eyedropper') {
      const pixel = context.getImageData(location.x, location.y, 1, 1).data;
      doc.querySelector('#brush-color').value = `#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      setTool('brush');
      return;
    }
    if (activeTool === 'cursor' || activeTool === 'select') return;
    event.preventDefault();
    rememberForUndo();
    if (activeTool === 'fill') {
      draftContext.fillStyle = doc.querySelector('#brush-color').value;
      draftContext.fillRect(0, 0, frameWidth, frameHeight);
      saveActiveFrame();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
      return;
    }
    if (activeTool === 'text') {
      const text = global.prompt('Texte à ajouter :');
      if (text) {
        draftContext.fillStyle = doc.querySelector('#brush-color').value;
        draftContext.font = `${Math.max(16, Number(doc.querySelector('#brush-size').value) * 4)}px sans-serif`;
        draftContext.fillText(text, location.x, location.y);
        saveActiveFrame();
        paintFrame(activeFrame);
        refreshTimeline();
        scheduleProjectSave();
      }
      return;
    }
    drawing = true;
    paintStart = location;
    canvas.setPointerCapture(event.pointerId);
    draftContext.beginPath();
    draftContext.moveTo(location.x, location.y);
    draftContext.lineTo(location.x + 0.01, location.y + 0.01);
    draftContext.strokeStyle = activeTool === 'erase' ? 'rgba(0,0,0,1)' : doc.querySelector('#brush-color').value;
    draftContext.globalCompositeOperation = activeTool === 'erase' ? 'destination-out' : 'source-over';
    draftContext.lineWidth = Number(doc.querySelector('#brush-size').value);
    draftContext.lineCap = 'round';
    draftContext.lineJoin = 'round';
    draftContext.stroke();
    draftContext.globalCompositeOperation = 'source-over';
    paintFrame(activeFrame);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const location = point(event);
    draftContext.beginPath();
    draftContext.moveTo(paintStart.x, paintStart.y);
    draftContext.lineTo(location.x, location.y);
    draftContext.strokeStyle = activeTool === 'erase' ? 'rgba(0,0,0,1)' : doc.querySelector('#brush-color').value;
    draftContext.globalCompositeOperation = activeTool === 'erase' ? 'destination-out' : 'source-over';
    draftContext.lineWidth = Number(doc.querySelector('#brush-size').value);
    draftContext.lineCap = 'round';
    draftContext.lineJoin = 'round';
    draftContext.stroke();
    draftContext.globalCompositeOperation = 'source-over';
    paintStart = location;
    paintFrame(activeFrame);
  });
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);

  function setTool(tool) {
    activeTool = tool;
    doc.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('selected', button.dataset.tool === tool));
    canvas.style.cursor = tool === 'cursor' ? 'default' : tool === 'select' ? 'crosshair' : 'crosshair';
  }
  doc.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  doc.querySelector('#brush-size').addEventListener('input', event => {
    doc.querySelector('#brush-size-value').value = event.target.value;
    doc.querySelector('#brush-size-side').value = `${event.target.value} px`;
    doc.querySelector('#brush-size-side-control').value = event.target.value;
  });
  doc.querySelector('#brush-size-side-control').addEventListener('input', event => {
    doc.querySelector('#brush-size').value = event.target.value;
    doc.querySelector('#brush-size').dispatchEvent(new Event('input'));
  });
  doc.querySelector('#animation-fps').addEventListener('change', scheduleProjectSave);
  doc.querySelector('#undo-frame').addEventListener('click', () => {
    const previous = undoStacks[activeFrame].pop();
    if (!previous) return;
    draftContext.putImageData(previous, 0, 0);
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.querySelector('#clear-frame').addEventListener('click', () => {
    rememberForUndo();
    draftContext.clearRect(0, 0, frameWidth, frameHeight);
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.querySelector('#delete-frame').addEventListener('click', () => {
    if (frameCount === 1) return;
    layers.forEach(layer => layer.frames.splice(activeFrame, 1));
    undoStacks.splice(activeFrame, 1);
    frameCount -= 1;
    activeFrame = Math.min(activeFrame, frameCount - 1);
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  function insertFrame(mode) {
    saveActiveFrame();
    const sourceIndex = activeFrame;
    layers.forEach(layer => {
      const source = layer.frames[sourceIndex];
      layer.frames.splice(sourceIndex + 1, 0, mode === 'drawing' ? null : cloneImageData(source));
    });
    undoStacks.splice(sourceIndex + 1, 0, []);
    activeFrame += 1;
    frameCount += 1;
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = mode === 'drawing' ? 'Nouveau dessin ajouté.' : mode === 'extend' ? 'Exposition prolongée.' : 'Dessin dupliqué.';
  }
  doc.querySelector('#add-frame').addEventListener('click', () => insertFrame('drawing'));
  doc.querySelector('#duplicate-frame').addEventListener('click', () => insertFrame('duplicate'));
  doc.querySelector('#extend-frame').addEventListener('click', () => insertFrame('extend'));
  doc.querySelector('#add-layer').addEventListener('click', () => {
    saveActiveFrame();
    const count = layers.filter(layer => !layer.locked).length + 1;
    const layer = { id: `layer-${Date.now()}`, name: `Layer ${count + 1}`, visible: true, locked: false, frames: Array(frameCount).fill(null) };
    layers.push(layer);
    activeLayerId = layer.id;
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.querySelector('#previous-frame').addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
  doc.querySelector('#timeline-prev').addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
  doc.querySelector('#next-frame').addEventListener('click', () => selectFrame(Math.min(frameCount - 1, activeFrame + 1)));
  doc.querySelector('#timeline-next').addEventListener('click', () => selectFrame(Math.min(frameCount - 1, activeFrame + 1)));
  doc.querySelector('#timeline-scale').addEventListener('input', refreshTimeline);
  doc.querySelector('#onion-skin').addEventListener('change', () => {
    doc.querySelector('#stage-onion').setAttribute('aria-pressed', String(onionToggle.checked));
    paintFrame(activeFrame);
  });
  doc.querySelector('#stage-onion').addEventListener('click', () => {
    onionToggle.checked = !onionToggle.checked;
    onionToggle.dispatchEvent(new Event('change'));
  });
  doc.querySelector('#toggle-settings').addEventListener('click', () => {
    doc.querySelector('#brush-settings').hidden = !doc.querySelector('#brush-settings').hidden;
  });
  doc.querySelector('#toggle-layers').addEventListener('click', () => {
    doc.querySelector('#desk-timeline').classList.remove('is-collapsed');
  });
  doc.querySelector('#toggle-timeline').addEventListener('click', event => {
    toggleTimeline(event.currentTarget);
  });
  doc.querySelector('#toggle-timeline-stage').addEventListener('click', event => toggleTimeline(event.currentTarget));
  function toggleTimeline(button) {
    const timeline = doc.querySelector('#desk-timeline');
    timeline.classList.toggle('is-collapsed');
    const collapsed = timeline.classList.contains('is-collapsed');
    button.textContent = collapsed ? '▴' : '▾';
    button.setAttribute('aria-label', collapsed ? 'Déplier la timeline' : 'Replier la timeline');
  }
  doc.querySelector('#zoom-control').addEventListener('input', event => {
    doc.querySelector('.canvas-matte').style.setProperty('--scene-zoom', Number(event.target.value) / 100);
  });
  doc.querySelector('#color-swatch').addEventListener('click', event => {
    if (event.target !== doc.querySelector('#brush-color')) doc.querySelector('#brush-color').click();
  });
  doc.querySelector('#actions-tab').addEventListener('click', event => {
    const menu = doc.querySelector('#desk-action-menu');
    menu.hidden = !menu.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
  });
  doc.querySelector('#menu-export-video').addEventListener('click', () => {
    doc.querySelector('#desk-action-menu').hidden = true;
    exportVideo();
  });
  doc.querySelector('#menu-clear-frame').addEventListener('click', () => {
    doc.querySelector('#desk-action-menu').hidden = true;
    doc.querySelector('#clear-frame').click();
  });
  doc.querySelector('#export-frame').addEventListener('click', async () => {
    saveActiveFrame();
    paintFrame(activeFrame, false);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob) {
      const filename = `image-${activeFrame + 1}.png`;
      downloadFile(blob, filename, 'image/png');
      try { await saveLibraryAsset({ id: uuid(), kind: 'clips', name: filename, mimeType: 'image/png', blob, createdAt: Date.now() }); }
      catch (error) { libraryStatus.textContent = `Image exportée, mais non ajoutée à Library : ${error.message}`; }
    }
  });
  function stopPlayback() {
    clearInterval(playbackTimer);
    playbackTimer = null;
    doc.querySelectorAll('#play-animation, #timeline-play, #stage-play').forEach(button => { button.textContent = '▶'; });
    paintFrame(activeFrame);
  }
  function togglePlayback() {
    if (playbackTimer) { stopPlayback(); return; }
    saveActiveFrame();
    playbackIndex = 0;
    doc.querySelectorAll('#play-animation, #timeline-play, #stage-play').forEach(button => { button.textContent = '■'; });
    paintFrame(playbackIndex, false);
    playbackTimer = setInterval(() => {
      const nextIndex = playbackIndex + 1;
      if (nextIndex >= frameCount) {
        if (doc.querySelector('#loop-playback').getAttribute('aria-pressed') === 'true') playbackIndex = 0;
        else { stopPlayback(); return; }
      } else playbackIndex = nextIndex;
      paintFrame(playbackIndex, false);
    }, 1000 / Number(doc.querySelector('#animation-fps').value));
  }
  doc.querySelector('#play-animation').addEventListener('click', togglePlayback);
  doc.querySelector('#timeline-play').addEventListener('click', togglePlayback);
  doc.querySelector('#stage-play').addEventListener('click', togglePlayback);
  doc.querySelector('#stage-to-first').addEventListener('click', () => selectFrame(0));
  doc.querySelector('#stage-to-last').addEventListener('click', () => selectFrame(frameCount - 1));
  doc.querySelector('#loop-playback').addEventListener('click', event => {
    event.currentTarget.setAttribute('aria-pressed', String(event.currentTarget.getAttribute('aria-pressed') !== 'true'));
  });
  async function exportVideo() {
    const status = doc.querySelector('#animation-status');
    if (!global.MediaRecorder || !canvas.captureStream) {
      status.textContent = 'L’export MP4 n’est pas disponible dans ce navigateur.';
      return;
    }
    if (recording) return;
    if (playbackTimer) stopPlayback();
    saveActiveFrame();
    const fps = Number(doc.querySelector('#animation-fps').value);
    const output = doc.createElement('canvas');
    output.width = frameWidth;
    output.height = frameHeight;
    const outputContext = output.getContext('2d');
    const stream = output.captureStream(fps);
    const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'].find(type => global.MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      stream.getTracks().forEach(track => track.stop());
      status.textContent = 'Ce navigateur ne possède pas d’encodeur MP4 compatible. Essayez un navigateur qui prend en charge MediaRecorder MP4.';
      return;
    }
    const chunks = [];
    let recorder;
    try { recorder = new global.MediaRecorder(stream, { mimeType }); }
    catch { stream.getTracks().forEach(track => track.stop()); status.textContent = 'Impossible de démarrer l’enregistrement vidéo.'; return; }
    const totalFrames = frameCount * Number(doc.querySelector('#loop-count').value);
    const filename = slugify(doc.querySelector('#animation-name').value || 'animation-hef');
    let rendered = 0;
    let timer;
    recording = true;
    const button = doc.querySelector('#export-video');
    button.disabled = true;
    status.textContent = 'Enregistrement de la séquence…';
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { status.textContent = 'L’enregistrement vidéo a rencontré une erreur.'; };
    recorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach(track => track.stop());
      const videoBlob = new Blob(chunks, { type: mimeType });
      downloadFile(videoBlob, `${filename}.mp4`, mimeType);
      let libraryMessage = '';
      try {
        await saveLibraryAsset({ id: uuid(), kind: 'clips', name: `${filename}.mp4`, mimeType, blob: videoBlob, createdAt: Date.now() });
        libraryMessage = ' Ajoutée à Library.';
      } catch (error) {
        console.warn('Export vidéo non ajouté à Library.', error);
      }
      recording = false;
      button.disabled = false;
      paintFrame(activeFrame);
      status.textContent = `Vidéo ${filename}.mp4 exportée (${frameCount} images, ${fps} images/s).${libraryMessage}`;
    };
    recorder.start();
    function drawExportFrame(index) {
      paintFrame(index, false, outputContext);
      rendered += 1;
    }
    drawExportFrame(0);
    timer = setInterval(() => {
      if (rendered >= totalFrames) { clearInterval(timer); recorder.stop(); return; }
      drawExportFrame(rendered % frameCount);
    }, 1000 / fps);
  }
  doc.querySelector('#export-video').addEventListener('click', exportVideo);
  refreshTimeline();
  loadDraft();
  paintFrame(0);
})(globalThis);
