(function (global) {
  'use strict';

  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[index] = value >>> 0;
  }
  let propertiesLayerId = null;
  function openLayerProperties(layer = activeLayer()) {
    if (!layer) return;
    propertiesLayerId = layer.id;
    doc.querySelector('#layer-type').value = layer.type || 'pixel';
    doc.querySelector('#layer-opacity').value = Math.round((layer.opacity ?? 1) * 100);
    doc.querySelector('#layer-opacity-value').value = `${doc.querySelector('#layer-opacity').value} %`;
    doc.querySelector('#layer-blend').value = layer.blendMode || 'source-over';
    doc.querySelector('#layer-muted').checked = Boolean(layer.muted);
    doc.querySelector('#layer-locked').checked = Boolean(layer.locked);
    doc.querySelector('#onion-skin-layer').checked = layer.onionSkin !== false;
    doc.querySelector('#symbol-own-fps').checked = Boolean(layer.ownFps);
    doc.querySelector('#symbol-fps').value = layer.fps || Number(doc.querySelector('#animation-fps').value);
    doc.querySelector('#symbol-loop').value = layer.loopMode || 'normal';
    doc.querySelector('#desk-properties-dialog').showModal();
  }
  function makeLayer(name, id = `layer-${uuid()}`) {
    return {
      id, name, visible: true, locked: false, muted: false, opacity: 1, blendMode: 'source-over',
      type: 'pixel', onionSkin: true, ownFps: false, fps: Number(doc.querySelector('#animation-fps').value),
      loopMode: 'normal', frames: Array(frameCount).fill(null), keyframes: Array(frameCount).fill(false),
      motion: Array.from({ length: frameCount }, identityPose)
    };
  }
  function cloneLayer(source, name = `${source.name} copy`) {
    return {
      ...source, id: `layer-${uuid()}`, name,
      frames: source.frames.map(frame => frame ? cloneImageData(frame) : null),
      keyframes: source.keyframes.slice(),
      motion: source.motion.map(pose => normalizePose(pose))
    };
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
  toolNav.id = 'creative-tools-nav';
  toolNav.setAttribute('aria-label', 'Outils créatifs');
  toolNav.innerHTML = '<button type="button" data-view="projects" aria-current="page"><span aria-hidden="true">▦</span>Mes projets</button><button type="button" data-view="addons"><span aria-hidden="true">◆</span>Add-ons Minecraft</button><button type="button" data-view="animation"><span aria-hidden="true">▻</span>Animation vidéo</button>';
  sidebar.querySelector('.side-note')?.before(toolLabel, toolNav);

  projectView.id = 'projects-view';
  main.insertAdjacentHTML('beforeend', `
    <section class="tool-view" id="addons-view" hidden aria-labelledby="addons-title">
      <p class="eyebrow">Atelier Minecraft</p>
      <h1 id="addons-title">Créez votre add-on</h1>
      <p class="intro tool-intro">Créez des objets, blocs, créatures, recettes ou disques musicaux et exportez un pack prêt à importer dans Minecraft Bedrock.</p>
      <div class="addon-layout">
        <form class="addon-form" id="addon-form">
          <div class="addon-fields">
            <div class="field"><label for="addon-kind">Type de contenu</label><select id="addon-kind"><option value="item">Objet personnalisé</option><option value="block">Bloc personnalisé</option><option value="entity">Entité personnalisée</option><option value="recipe">Recette personnalisée</option><option value="music-disc">Disque musical personnalisé</option></select></div>
            <div class="field"><label for="addon-name">Nom</label><input id="addon-name" maxlength="40" required value="Cristal solaire"></div>
            <div class="field"><label for="addon-id">Identifiant technique</label><div class="identifier"><span>hefcreative:</span><input id="addon-id" maxlength="32" pattern="[a-z0-9_]+" required value="cristal_solaire" aria-describedby="addon-id-help"></div><small id="addon-id-help">Minuscules, chiffres et tirets bas. Préfixe hefcreative: ajouté à l’export.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="item"><label for="addon-stack">Taille de pile</label><select id="addon-stack"><option>1</option><option>16</option><option selected>64</option></select><label class="check-field"><input id="addon-hand" type="checkbox"> Tenir l’objet comme un outil</label></div>
            <div class="field addon-kind-panel" data-addon-kind="block" hidden><label for="addon-hardness">Résistance à la pioche (secondes)</label><input id="addon-hardness" type="number" min="0" max="3600" step="0.1" value="1.5" required></div>
            <div class="field addon-kind-panel" data-addon-kind="entity" hidden><label for="addon-health">Points de vie</label><input id="addon-health" type="number" min="1" max="1024" step="1" value="20" required><small>Crée une créature passive cubique avec un œuf d’apparition.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="recipe" hidden>
              <label for="recipe-mode">Type de recette</label><select id="recipe-mode"><option value="shaped">Forme précise (3 × 3)</option><option value="shapeless">Sans forme précise</option></select>
              <label for="recipe-ingredients" id="recipe-ingredients-label">Grille : un identifiant d’objet par case, séparé par des virgules (ligne vide = case vide)</label><textarea id="recipe-ingredients" rows="3" spellcheck="false">minecraft:stone,minecraft:stone,minecraft:stone
minecraft:stone,,minecraft:stone
minecraft:stone,minecraft:stone,minecraft:stone</textarea>
              <label for="recipe-result">Identifiant du résultat</label><input id="recipe-result" required value="hefcreative:cristal_solaire" pattern="[a-z0-9_.-]+:[a-z0-9_./-]+">
              <label for="recipe-count">Quantité obtenue</label><input id="recipe-count" type="number" min="1" max="64" value="1" required>
              <small>Exemple d’ingrédient : minecraft:diamond ou hefcreative:cristal_solaire.</small>
            </div>
            <div class="field addon-kind-panel" data-addon-kind="music-disc" hidden><label for="addon-audio">Fichier audio OGG</label><input id="addon-audio" type="file" accept=".ogg,audio/ogg" required><label for="addon-duration">Durée (secondes)</label><input id="addon-duration" type="number" min="1" max="600" value="180" required><small>Le navigateur peut lire l’aperçu ; Minecraft Bedrock attend un fichier OGG.</small></div>
            <div class="field addon-kind-panel" data-addon-texture><label for="addon-color">Couleur de la texture</label><div class="texture-controls"><input id="addon-color" type="color" value="#eaa44e" aria-label="Couleur de la texture"><label class="upload-texture" for="addon-texture">Importer une texture PNG/JPEG</label><input class="visually-hidden" id="addon-texture" type="file" accept="image/png,image/jpeg,image/webp"></div><small id="addon-texture-help">La texture sera convertie en PNG 16 × 16.</small></div>
            <button class="primary" type="submit"><span aria-hidden="true">↓</span> Télécharger le .mcaddon</button>
            <p class="tool-status" id="addon-status" role="status" aria-live="polite">Choisissez un type de contenu pour configurer votre add-on Bedrock.</p>
          </div>
        </form>
        <div class="addon-preview" aria-label="Aperçu de l’add-on">
          <div class="preview-heading"><span>APERÇU DE L’ADD-ON</span><span class="preview-version">BEDROCK</span></div>
          <div class="item-stage"><canvas id="addon-preview" width="16" height="16" aria-label="Aperçu de la texture"></canvas></div>
          <h2 id="addon-preview-name">Cristal solaire</h2>
          <p id="addon-preview-id">hefcreative:cristal_solaire</p>
          <div class="preview-divider"></div>
          <div class="pack-includes"><span class="pack-check">✓</span><span><strong>Pack de comportement</strong><small>Définitions, entités et recettes</small></span></div>
          <div class="pack-includes"><span class="pack-check">✓</span><span><strong>Pack de ressources</strong><small>Textures et ressources audio</small></span></div>
        </div>
      </div>
    </section>
    <section class="tool-view animation-view" id="animation-view" hidden aria-label="Animation Desk">
      <header class="desk-topbar">
        <nav class="desk-tabs" aria-label="Navigation Animation Desk"><button type="button" data-home-view aria-label="Retour à l’accueil" title="Retour à l’accueil"><span class="desk-home-icon" aria-hidden="true">⌂</span><span class="desk-home-label">Accueil</span></button><button type="button" id="projects-tab">Projects</button><button type="button" id="library-tab">Library</button><button type="button" id="actions-tab" aria-expanded="false">Actions</button></nav>
        <span class="desk-document-name">Sans titre <span>●</span></span>
        <div class="desk-top-controls"><button class="desk-icon" type="button" id="play-animation" aria-label="Lire l’animation" title="Lire">▶</button><label title="Taille du pinceau"><input id="brush-size" type="range" min="1" max="28" value="5"><output id="brush-size-value">5</output></label><label title="Zoom de la scène"><input id="zoom-control" type="range" min="50" max="150" value="100"></label><button class="desk-export" id="export-video" type="button">Exporter</button></div>
      </header>
      <div class="desk-workspace">
        <nav class="desk-tool-rail" aria-label="Outils de dessin">
          <button type="button" data-tool="cursor" title="Pointeur" aria-label="Pointeur">↖</button><button type="button" data-tool="select" title="Sélection" aria-label="Sélection">▧</button><button type="button" data-tool="transform" title="Glisser pour déplacer, molette pour redimensionner, Maj + molette pour pivoter" aria-label="Transformer le calque">⤧</button><span></span><button class="selected" type="button" data-tool="brush" title="Pinceau" aria-label="Pinceau">╱</button><button type="button" data-tool="erase" title="Gomme" aria-label="Gomme">◩</button><button type="button" data-tool="smudge" title="Flou" aria-label="Flou">✋</button><button type="button" data-tool="fill" title="Remplir le calque" aria-label="Remplir le calque">◒</button><button type="button" data-tool="eyedropper" title="Pipette" aria-label="Pipette">⌖</button><button type="button" data-tool="text" title="Texte" aria-label="Texte">T</button><button type="button" data-tool="path" title="Cliquez pour poser les points du tracé, puis double-cliquez ou appuyez sur Entrée" aria-label="Outil de tracé">／</button>
          <button class="desk-tool-bottom" id="undo-frame" type="button" title="Annuler le dernier trait" aria-label="Annuler">↶</button><button id="clear-frame" type="button" title="Effacer l’image" aria-label="Effacer l’image">⌫</button>
        </nav>
        <div class="desk-stage-column">
          <div class="desk-canvas-area"><div class="canvas-matte"><canvas id="drawing-canvas" width="640" height="400" aria-label="Zone de dessin de l’image courante" role="img"></canvas></div></div>
          <div class="desk-stage-bar"><div class="stage-left-controls"><button id="previous-frame" type="button" title="Image précédente" aria-label="Image précédente">|◀</button><button id="next-frame" type="button" title="Image suivante" aria-label="Image suivante">▶|</button><button id="stage-onion" type="button" aria-pressed="true" title="Pelure d’oignon" aria-label="Pelure d’oignon">◐</button><button id="loop-playback" type="button" aria-pressed="true" title="Lecture en boucle" aria-label="Lecture en boucle">⟳</button></div><div class="stage-transport"><button id="stage-to-first" type="button" title="Revenir à la première image" aria-label="Revenir à la première image">≪</button><button id="stage-play" type="button" title="Lire l’animation" aria-label="Lire l’animation">▶</button><button id="stage-to-last" type="button" title="Aller à la dernière image" aria-label="Aller à la dernière image">≫</button></div><span class="stage-scene">Scene 1</span><label class="stage-fps">24 fps <select id="animation-fps" aria-label="Images par seconde"><option>4</option><option>8</option><option>12</option><option>16</option><option selected>24</option></select></label><span id="animation-status" role="status" aria-live="polite">Prêt</span><button id="toggle-timeline-stage" type="button" aria-label="Replier la timeline" title="Replier la timeline">▾</button></div>
        </div>
        <aside class="desk-inspector" aria-label="Réglages"><button type="button" id="color-swatch" title="Choisir une couleur" aria-label="Choisir une couleur"><input id="brush-color" type="color" value="#111111" aria-label="Couleur du pinceau"></button><button type="button" id="toggle-brush-library" aria-label="Choisir un pinceau" aria-expanded="false" title="Choisir un pinceau">≋</button><button type="button" id="toggle-layers" aria-label="Afficher les calques" title="Calques">◆</button><button type="button" id="toggle-settings" aria-label="Réglages du pinceau" title="Réglages">☷</button><div class="brush-library" id="brush-library" hidden aria-label="Bibliothèque de pinceaux"><strong>Pinceaux</strong><div class="brush-presets"><button type="button" data-brush="round" aria-pressed="true"><span class="brush-sample sample-round"></span><span>Rond</span></button><button type="button" data-brush="pencil" aria-pressed="false"><span class="brush-sample sample-pencil"></span><span>Crayon</span></button><button type="button" data-brush="marker" aria-pressed="false"><span class="brush-sample sample-marker"></span><span>Marqueur</span></button><button type="button" data-brush="airbrush" aria-pressed="false"><span class="brush-sample sample-airbrush"></span><span>Aérographe</span></button></div></div><div class="brush-settings" id="brush-settings" hidden><label>Taille <output id="brush-size-side">5 px</output><input id="brush-size-side-control" type="range" min="1" max="28" value="5"></label><label>Opacité <output id="brush-opacity-value">100 %</output><input id="brush-opacity" type="range" min="10" max="100" value="100"></label><label class="brush-check"><input id="brush-pressure" type="checkbox"> Pression du stylet</label><label class="onion-setting"><input id="onion-skin" type="checkbox" checked> Pelure d’oignon</label><label>Nombre de boucles<select id="loop-count"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="5">5</option></select></label><label>Nom du fichier<input id="animation-name" type="text" value="mon-animation" maxlength="40"></label></div><label class="visually-hidden">Épaisseur <output id="brush-size-value-accessible">5 px</output></label></aside>
      </div>
      <section class="desk-timeline" id="desk-timeline" aria-label="Timeline de l’animation">
        <header class="timeline-topbar"><div class="timeline-top-left"><button type="button" id="toggle-timeline" aria-label="Réduire la timeline" title="Réduire la timeline">⌄</button><strong>Timeline</strong><span id="frame-count">20 images</span></div><div class="timeline-mini-controls"><button type="button" id="timeline-prev" aria-label="Reculer d’une image">◀</button><button type="button" id="timeline-play" aria-label="Lire l’animation">▶</button><button type="button" id="timeline-next" aria-label="Avancer d’une image">▶|</button><button type="button" id="open-markers" title="Rechercher et gérer les marqueurs">Marqueurs</button><select id="motion-easing" aria-label="Courbe d’accélération"><option value="linear">Linéaire</option><option value="hold">Maintien</option><option value="easeIn">Ease In</option><option value="easeOut">Ease Out</option><option value="easeInOut">Ease In Out</option><option value="sine">Sine</option><option value="circular">Circular</option><option value="back">Back</option><option value="elastic">Elastic</option><option value="bounce">Bounce</option><option value="exponential">Exponential</option><option value="cubic">Cubic</option><option value="quartic">Quartic</option><option value="quintic">Quintic</option></select><label title="Zoom de la timeline"><input type="range" min="42" max="100" value="52" id="timeline-scale"></label></div><span class="scene-info">Scene 1 <span>24 fps</span></span></header>
        <div class="timeline-body"><div class="layer-column"><div class="layer-column-heading">Calques <button type="button" id="add-layer" title="Ajouter un calque" aria-label="Ajouter un calque">+</button></div><div id="layer-list"></div></div><div class="track-viewport"><div id="frame-ruler"></div><div id="layer-tracks"></div><div class="frame-commands"><button type="button" id="add-keyframe" title="Créer une image clé sur le calque actif">◆ Image clé</button><label class="motion-tween-control" title="Interpoler position, taille et rotation entre les images clés"><input id="motion-tween" type="checkbox" checked> Déplacement auto</label><button type="button" id="add-frame">＋ Add Drawing</button><button type="button" id="duplicate-frame">⧉ Duplicate</button><button type="button" id="extend-frame">↔ Extend</button><button type="button" id="delete-frame" aria-label="Supprimer l’image sélectionnée">⌫</button></div></div></div>
      </section>
      <div class="desk-action-menu" id="desk-action-menu" hidden><button type="button" id="menu-copy-drawing">Copier le dessin</button><button type="button" id="menu-paste-drawing">Coller le dessin</button><button type="button" id="menu-select-all-layers">Sélectionner tous les calques</button><button type="button" id="menu-copy-layer">Copier le calque</button><button type="button" id="menu-paste-layer">Coller le calque</button><button type="button" id="menu-duplicate-layer">Dupliquer le calque</button><button type="button" id="menu-rename-layer">Renommer le calque</button><button type="button" id="menu-lock-layer">Verrouiller / déverrouiller</button><button type="button" id="menu-layer-properties">Propriétés du calque</button><button type="button" id="menu-rasterize-layer">Rasteriser le calque</button><button type="button" id="menu-add-drawing">Ajouter un dessin</button><button type="button" id="menu-split-drawing">Séparer le dessin</button><button type="button" id="menu-create-symbol">Créer un symbole</button><button type="button" id="menu-open-symbols">Symboles</button><button type="button" id="menu-add-marker">Ajouter un marqueur</button><button type="button" id="menu-delete-selection">Supprimer la sélection</button><hr><button type="button" id="menu-export-video">Exporter la vidéo…</button><button type="button" id="export-frame">Exporter l’image PNG</button><button type="button" id="menu-clear-frame">Effacer l’image courante</button></div>
      <dialog class="desk-properties-dialog" id="desk-properties-dialog" aria-labelledby="desk-properties-title"><form method="dialog"><header><h2 id="desk-properties-title">Propriétés du calque</h2><button value="cancel" aria-label="Fermer">×</button></header><label>Type<select id="layer-type"><option value="pixel">Calque pixel</option><option value="animation">Calque d’animation</option><option value="symbol">Calque symbole</option></select></label><label>Opacité <output id="layer-opacity-value">100 %</output><input id="layer-opacity" type="range" min="0" max="100" value="100"></label><label>Mode de fusion<select id="layer-blend"><option value="source-over">Normal</option><option value="multiply">Multiplier</option><option value="screen">Écran</option><option value="overlay">Superposition</option><option value="darken">Obscurcir</option><option value="lighten">Éclaircir</option><option value="lighter">Ajouter</option></select></label><label class="property-check"><input id="layer-muted" type="checkbox"> Muet</label><label class="property-check"><input id="layer-locked" type="checkbox"> Verrouillé</label><label class="property-check"><input id="onion-skin-layer" type="checkbox" checked> Pelure d’oignon</label><label class="property-check"><input id="symbol-own-fps" type="checkbox"> Cadence propre au symbole</label><label>Cadence du symbole<input id="symbol-fps" type="number" min="1" max="60" value="24"></label><label>Boucle du symbole<select id="symbol-loop"><option value="normal">Normale</option><option value="once">Une fois</option><option value="pingpong">Ping-pong</option></select></label><button class="desk-property-save" value="default">Terminé</button></form></dialog>
      <dialog class="desk-markers-dialog" id="desk-markers-dialog" aria-labelledby="desk-markers-title"><form method="dialog"><header><h2 id="desk-markers-title">Marqueurs</h2><button value="cancel" aria-label="Fermer">×</button></header><label>Rechercher un marqueur<input id="marker-search" type="search" placeholder="Rechercher"></label><div id="marker-list"></div><div class="marker-dialog-actions"><button type="button" id="marker-add">Ajouter à l’image actuelle</button><button class="desk-property-save" value="default">Fermer</button></div></form></dialog>
      <dialog class="desk-symbols-dialog" id="desk-symbols-dialog" aria-labelledby="desk-symbols-title"><form method="dialog"><header><h2 id="desk-symbols-title">Symboles</h2><button value="cancel" aria-label="Fermer">×</button></header><div id="symbol-list"></div><div class="marker-dialog-actions"><button type="button" id="symbol-create">Créer depuis le calque actif</button><button class="desk-property-save" value="default">Fermer</button></div></form></dialog>
      <p class="visually-hidden" id="animation-announcer" aria-live="polite"></p>
    </section>
    <section class="tool-view desk-projects-view" id="desk-projects-view" hidden aria-label="Animation Desk Projects">
      <header class="desk-topbar"><nav class="desk-tabs" aria-label="Navigation Projects"><button type="button" data-home-view aria-label="Retour à l’accueil" title="Retour à l’accueil"><span class="desk-home-icon" aria-hidden="true">⌂</span><span class="desk-home-label">Accueil</span></button><button type="button" class="current">Projects</button><button type="button" id="desk-project-library">Library</button><button type="button" id="desk-project-animation">Animation Desk</button></nav><span class="desk-document-name">HEF Creative</span></header>
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
      <header class="desk-topbar library-topbar"><nav class="desk-tabs" aria-label="Navigation Library"><button type="button" data-home-view aria-label="Retour à l’accueil" title="Retour à l’accueil"><span class="desk-home-icon" aria-hidden="true">⌂</span><span class="desk-home-label">Accueil</span></button><button type="button" id="library-projects-tab">Projects</button><button type="button" class="current">Library</button><button type="button" id="library-animation-tab">Animation Desk</button></nav><span class="desk-document-name">HEF Creative</span></header>
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
  const brand = sidebar.querySelector('.brand');
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
    main.classList.toggle('animation-layout-open', name === 'animation');
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
  brand.addEventListener('click', event => {
    event.preventDefault();
    activateView('projects');
  });
  doc.querySelectorAll('[data-home-view]').forEach(button => button.addEventListener('click', () => activateView('projects')));
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
  const addonKind = doc.querySelector('#addon-kind');
  const addonStatus = doc.querySelector('#addon-status');
  const addonAudioInput = doc.querySelector('#addon-audio');
  let importedAudio = null;
  let importedTexture = null;

  function updateAddonKind() {
    const kind = addonKind.value;
    doc.querySelectorAll('.addon-kind-panel').forEach(panel => {
      const visible = panel.dataset.addonKind === kind || (panel.hasAttribute('data-addon-texture') && kind !== 'recipe');
      panel.hidden = !visible;
      panel.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = !visible; });
    });
    addonId.value = addonId.value.split(':').pop();
    doc.querySelector('#addon-texture-help').textContent = kind === 'block' || kind === 'entity'
      ? 'La texture sera appliquée au bloc ou au modèle cubique.'
      : 'La texture sera convertie en PNG 16 × 16.';
    addonStatus.textContent = {
      item: 'Un objet personnalisé avec texture sera exporté.',
      block: 'Un bloc cubique destructible et sa texture seront exportés.',
      entity: 'Une créature passive, son œuf et son modèle cubique seront exportés.',
      recipe: 'Une recette Bedrock sera ajoutée au pack de comportement.',
      'music-disc': 'Un objet musical et le fichier OGG fourni seront exportés.'
    }[kind];
    drawGem();
  }

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
    const recipeResult = doc.querySelector('#recipe-result');
    if (!recipeResult.dataset.edited) recipeResult.value = `hefcreative:${slugify(addonId.value)}`;
    if (!importedTexture) drawGem();
    else {
      doc.querySelector('#addon-preview-name').textContent = addonName.value || 'Votre objet';
      doc.querySelector('#addon-preview-id').textContent = `hefcreative:${addonId.value || 'nouvel_objet'}`;
    }
  });
  addonId.addEventListener('input', () => {
    addonId.dataset.edited = 'true';
    const recipeResult = doc.querySelector('#recipe-result');
    if (!recipeResult.dataset.edited) recipeResult.value = `hefcreative:${slugify(addonId.value)}`;
    if (!importedTexture) drawGem();
    else doc.querySelector('#addon-preview-id').textContent = `hefcreative:${addonId.value || 'nouvel_objet'}`;
  });
  doc.querySelector('#recipe-result').addEventListener('input', event => { event.target.dataset.edited = 'true'; });
  addonKind.addEventListener('change', updateAddonKind);
  doc.querySelector('#recipe-mode').addEventListener('change', event => {
    const shaped = event.target.value === 'shaped';
    doc.querySelector('#recipe-ingredients-label').textContent = shaped
      ? 'Grille : un identifiant d’objet par case, séparé par des virgules (ligne vide = case vide)'
      : 'Ingrédients : un identifiant d’objet par ligne';
    doc.querySelector('#recipe-ingredients').value = shaped
      ? 'minecraft:stone,minecraft:stone,minecraft:stone\nminecraft:stone,,minecraft:stone\nminecraft:stone,minecraft:stone,minecraft:stone'
      : 'minecraft:stone\nminecraft:stick';
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
      addonStatus.textContent = `Texture « ${file.name} » prête à être intégrée au pack.`;
    } catch {
      addonStatus.textContent = 'Cette image n’a pas pu être chargée. Choisissez un autre fichier.';
    }
  });
  addonAudioInput.addEventListener('change', () => {
    importedAudio = addonAudioInput.files?.[0] || null;
    if (importedAudio && importedAudio.type !== 'audio/ogg' && !importedAudio.name.toLowerCase().endsWith('.ogg')) {
      importedAudio = null;
      addonAudioInput.value = '';
      addonStatus.textContent = 'Le disque musical nécessite un fichier audio OGG.';
      return;
    }
    if (importedAudio) addonStatus.textContent = `Fichier « ${importedAudio.name} » prêt pour le disque musical.`;
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
  function recipeIngredientIds() {
    const ingredientText = doc.querySelector('#recipe-ingredients').value.trim();
    const mode = doc.querySelector('#recipe-mode').value;
    if (!ingredientText) throw new Error('Ajoutez au moins un ingrédient à la recette.');
    if (mode === 'shapeless') {
      const ingredients = ingredientText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (ingredients.length > 9) throw new Error('Une recette sans forme accepte au maximum 9 ingrédients.');
      ingredients.forEach(identifier => {
        if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(identifier)) throw new Error(`Identifiant d’ingrédient invalide : ${identifier}`);
      });
      return { ingredients: ingredients.map(item => ({ item })) };
    }
    const rows = ingredientText.split(/\r?\n/).map(line => line.split(',').map(item => item.trim()));
    if (rows.length !== 3 || rows.some(row => row.length !== 3)) throw new Error('La grille de recette doit contenir exactement 3 lignes de 3 cases séparées par des virgules.');
    const key = {};
    const pattern = rows.map((row, rowIndex) => row.map((identifier, columnIndex) => {
      if (!identifier) return ' ';
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(identifier)) throw new Error(`Identifiant d’ingrédient invalide : ${identifier}`);
      const symbol = String.fromCharCode(65 + rowIndex * 3 + columnIndex);
      key[symbol] = { item: identifier };
      return symbol;
    }).join(''));
    if (!Object.keys(key).length) throw new Error('Ajoutez au moins un ingrédient à la recette.');
    return { key, pattern };
  }
  async function createAddonFiles({ displayName, contentId, kind, textureBytes, resourceUuid, behaviorUuid, version, audioFile }) {
    const namespaceId = `hefcreative:${contentId}`;
    const resourceFiles = [];
    const behaviorFiles = [];
    let itemAtlas;
    if (kind === 'item') {
      const item = {
        format_version: '1.20.80',
        'minecraft:item': {
          description: { identifier: namespaceId, menu_category: { category: 'items' } },
          components: {
            'minecraft:display_name': { value: displayName },
            'minecraft:icon': contentId,
            'minecraft:max_stack_size': Number(doc.querySelector('#addon-stack').value),
            'minecraft:hand_equipped': doc.querySelector('#addon-hand').checked
          }
        }
      };
      behaviorFiles.push({ name: `items/${contentId}.json`, content: jsonFile(item) });
      itemAtlas = { [contentId]: { textures: `textures/items/${contentId}` } };
      resourceFiles.push({ name: `textures/items/${contentId}.png`, content: textureBytes });
    } else if (kind === 'block') {
      const hardness = Number(doc.querySelector('#addon-hardness').value);
      const localizedName = displayName.replace(/[\r\n]+/g, ' ');
      const block = {
        format_version: '1.20.80',
        'minecraft:block': {
          description: { identifier: namespaceId, menu_category: { category: 'construction' } },
          components: {
            'minecraft:material_instances': {
              '*': { texture: contentId, render_method: 'opaque' }
            },
            'minecraft:destructible_by_mining': { seconds_to_destroy: hardness },
            'minecraft:destructible_by_explosion': { explosion_resistance: hardness * 3 }
          }
        }
      };
      behaviorFiles.push({ name: `blocks/${contentId}.json`, content: jsonFile(block) });
      resourceFiles.push(
        { name: `textures/blocks/${contentId}.png`, content: textureBytes },
        { name: 'textures/terrain_texture.json', content: jsonFile({
          resource_pack_name: displayName,
          texture_name: 'atlas.terrain',
          padding: 8,
          num_mip_levels: 4,
          texture_data: { [contentId]: { textures: `textures/blocks/${contentId}` } }
        }) },
        { name: 'blocks.json', content: jsonFile({ [namespaceId]: { textures: contentId, sound: 'stone' } }) },
        { name: 'texts/languages.json', content: jsonFile(['en_US']) },
        { name: 'texts/en_US.lang', content: `tile.${namespaceId}.name=${localizedName}\n` }
      );
    } else if (kind === 'entity') {
      const localizedName = displayName.replace(/[\r\n]+/g, ' ');
      const entity = {
        format_version: '1.20.80',
        'minecraft:entity': {
          description: {
            identifier: namespaceId,
            is_spawnable: true,
            is_summonable: true,
            is_experimental: false,
            properties: {}
          },
          components: {
            'minecraft:type_family': { family: ['hefcreative', 'mob'] },
            'minecraft:health': { value: Number(doc.querySelector('#addon-health').value), max: Number(doc.querySelector('#addon-health').value) },
            'minecraft:collision_box': { width: 0.8, height: 1.8 },
            'minecraft:movement': { value: 0.25 },
            'minecraft:movement.basic': {},
            'minecraft:navigation.walk': { can_path_over_water: true, avoid_damage_blocks: true },
            'minecraft:jump.static': {},
            'minecraft:physics': {},
            'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
            'minecraft:nameable': {},
            'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 1 },
            'minecraft:behavior.look_at_player': { priority: 7, look_distance: 6, probability: 0.02 },
            'minecraft:behavior.random_look_around': { priority: 8 },
            'minecraft:spawn_egg': { base_color: addonColor.value, overlay_color: '#ffffff' }
          }
        }
      };
      const geometryId = `geometry.${contentId}`;
      const clientEntity = {
        format_version: '1.10.0',
        'minecraft:client_entity': {
          description: {
            identifier: namespaceId,
            materials: { default: 'entity_alphatest' },
            textures: { default: `textures/entity/${contentId}` },
            geometry: { default: geometryId },
            render_controllers: [`controller.render.hefcreative.${contentId}`]
          }
        }
      };
      const geometry = {
        format_version: '1.12.0',
        'minecraft:geometry': [{
          description: { identifier: geometryId, texture_width: 16, texture_height: 16, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0, 1, 0] },
          bones: [{ name: 'root', pivot: [0, 0, 0], cubes: [{ origin: [-8, 0, -8], size: [16, 16, 16], uv: [0, 0] }] }]
        }]
      };
      behaviorFiles.push({ name: `entities/${contentId}.json`, content: jsonFile(entity) });
      resourceFiles.push(
        { name: `entity/${contentId}.entity.json`, content: jsonFile(clientEntity) },
        { name: `models/entity/${contentId}.geo.json`, content: jsonFile(geometry) },
        { name: `textures/entity/${contentId}.png`, content: textureBytes },
        { name: 'textures/item_texture.json', content: jsonFile({
          resource_pack_name: displayName,
          texture_name: 'atlas.items',
          texture_data: { [`${contentId}_spawn_egg`]: { textures: `textures/items/${contentId}_spawn_egg` } }
        }) },
        { name: `textures/items/${contentId}_spawn_egg.png`, content: textureBytes },
        { name: 'texts/languages.json', content: jsonFile(['en_US']) },
        { name: 'texts/en_US.lang', content: `entity.${namespaceId}.name=${localizedName}\nitem.spawn_egg.entity.${namespaceId}.name=Spawn ${localizedName}\n` }
      );
    } else if (kind === 'recipe') {
      const recipe = recipeIngredientIds();
      const result = doc.querySelector('#recipe-result').value.trim();
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(result)) throw new Error('L’identifiant du résultat doit inclure un espace de noms, par exemple minecraft:diamond.');
      const recipeData = { ...recipe, result: { item: result, count: Number(doc.querySelector('#recipe-count').value) } };
      const recipeJson = { format_version: '1.20.10' };
      if (doc.querySelector('#recipe-mode').value === 'shaped') {
        recipeJson['minecraft:recipe_shaped'] = { description: { identifier: namespaceId }, ...recipeData, unlock: [{ context: 'AlwaysUnlocked' }] };
      } else {
        recipeJson['minecraft:recipe_shapeless'] = { description: { identifier: namespaceId }, ...recipeData };
      }
      behaviorFiles.push({ name: `recipes/${contentId}.json`, content: jsonFile(recipeJson) });
    } else if (kind === 'music-disc') {
      if (!audioFile) throw new Error('Sélectionnez un fichier audio OGG pour créer le disque musical.');
      const record = {
        format_version: '1.20.80',
        'minecraft:item': {
          description: { identifier: namespaceId, menu_category: { category: 'items' } },
          components: {
            'minecraft:display_name': { value: displayName },
            'minecraft:icon': contentId,
            'minecraft:max_stack_size': 1,
            'minecraft:record': { comparator_signal: 1, duration: Number(doc.querySelector('#addon-duration').value), sound_event: `hefcreative.${contentId}` }
          }
        }
      };
      behaviorFiles.push({ name: `items/${contentId}.json`, content: jsonFile(record) });
      itemAtlas = { [contentId]: { textures: `textures/items/${contentId}` } };
      resourceFiles.push(
        { name: `textures/items/${contentId}.png`, content: textureBytes },
        { name: 'sounds/sound_definitions.json', content: jsonFile({
          format_version: '1.14.0',
          sound_definitions: {
            [`hefcreative.${contentId}`]: {
              category: 'record',
              sounds: [{ name: `sounds/music_disc/${contentId}`, stream: true }]
            }
          }
        }) },
        { name: `sounds/music_disc/${contentId}.ogg`, content: new Uint8Array(await audioFile.arrayBuffer()) }
      );
    }
    const resourcePack = {
      format_version: 2,
      header: { name: `${displayName} — Ressources`, description: `Ressources pour ${displayName}`, uuid: resourceUuid, version, min_engine_version: [1, 20, 80] },
      modules: [{ description: 'Textures et ressources audio', type: 'resources', uuid: uuid(), version }]
    };
    const behaviorPack = {
      format_version: 2,
      header: { name: `${displayName} — Comportement`, description: `Contenu Bedrock créé avec HEF Creative`, uuid: behaviorUuid, version, min_engine_version: [1, 20, 80] },
      modules: [{ description: 'Définitions Bedrock', type: 'data', uuid: uuid(), version }],
      dependencies: [{ uuid: resourceUuid, version }]
    };
    const behaviorPackFiles = [
      { name: 'manifest.json', content: jsonFile(behaviorPack) },
      ...behaviorFiles
    ];
    const resourcePackFiles = [
      { name: 'manifest.json', content: jsonFile(resourcePack) },
      ...resourceFiles
    ];
    if (itemAtlas) resourcePackFiles.push({ name: 'textures/item_texture.json', content: jsonFile({ resource_pack_name: displayName, texture_name: 'atlas.items', texture_data: itemAtlas }) });
    if (kind === 'entity') resourcePackFiles.push({ name: `render_controllers/${contentId}.render_controllers.json`, content: jsonFile({
      format_version: '1.8.0',
      render_controllers: { [`controller.render.hefcreative.${contentId}`]: { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] } }
    }) });
    const baseName = slugify(displayName);
    return createZip([
      { name: `${baseName}_BP.mcpack`, content: createZip(behaviorPackFiles) },
      { name: `${baseName}_RP.mcpack`, content: createZip(resourcePackFiles) },
      { name: 'README.txt', content: `Contenu Minecraft Bedrock : ${displayName} (${kind}). Ouvrez ce fichier .mcaddon avec Minecraft Bedrock, puis activez les packs de comportement et de ressources dans votre monde.` }
    ]);
  }
  addonForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!addonForm.reportValidity()) return;
    const button = addonForm.querySelector('[type="submit"]');
    const status = addonStatus;
    button.disabled = true;
    status.textContent = 'Préparation de votre pack Minecraft…';
    try {
      const displayName = addonName.value.trim();
      const kind = addonKind.value;
      const contentId = slugify(addonId.value.split(':').pop());
      const resourceUuid = uuid();
      const behaviorUuid = uuid();
      const version = [1, 0, 0];
      const textureBytes = importedTexture
        ? new Uint8Array(await (await fetch(importedTexture)).arrayBuffer())
        : await canvasPng(addonCanvas);
      const archive = await createAddonFiles({
        displayName,
        contentId,
        kind,
        textureBytes,
        resourceUuid,
        behaviorUuid,
        version,
        audioFile: importedAudio
      });
      const baseName = slugify(displayName);
      downloadFile(archive, `${baseName}.mcaddon`, 'application/zip');
      status.textContent = `${displayName}.mcaddon est prêt. Ouvrez-le avec Minecraft Bedrock pour importer ${kind === 'music-disc' ? 'votre disque musical' : kind === 'entity' ? 'votre entité' : kind === 'recipe' ? 'votre recette' : kind === 'block' ? 'votre bloc' : 'votre objet'}.`;
    } catch (error) {
      console.error(error);
      status.textContent = `L’export a échoué : ${error.message || 'vérifiez que le navigateur autorise les téléchargements et réessayez.'}`;
    } finally {
      button.disabled = false;
    }
  });
  addonForm.addEventListener('input', () => { if (!importedTexture) drawGem(); });
  updateAddonKind();
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
  const sampleCanvas = doc.createElement('canvas');
  sampleCanvas.width = canvas.width;
  sampleCanvas.height = canvas.height;
  const sampleContext = sampleCanvas.getContext('2d');
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
    { id: 'background', name: 'Background', visible: true, locked: true, muted: false, opacity: 1, blendMode: 'source-over', type: 'pixel', frames: layerCell(), keyframes: Array(20).fill(false), motion: Array.from({ length: 20 }, identityPose) },
    { id: 'bg', name: 'BG', visible: true, locked: false, muted: false, opacity: 1, blendMode: 'source-over', type: 'pixel', frames: layerCell(), keyframes: Array(20).fill(false), motion: Array.from({ length: 20 }, identityPose) },
    { id: 'layer-2', name: 'Layer 2', visible: true, locked: false, muted: false, opacity: 1, blendMode: 'source-over', type: 'pixel', frames: layerCell(), keyframes: Array(20).fill(false), motion: Array.from({ length: 20 }, identityPose) }
  ];
  let activeLayerId = 'layer-2';
  let undoStacks = Array.from({ length: frameCount }, () => []);
  let undoMotionStacks = Array.from({ length: frameCount }, () => []);
  let activeFrame = 0;
  let drawing = false;
  let activeTool = 'brush';
  let activeBrush = 'round';
  let pathPoints = [];
  let pathBase = null;
  let motionTweenEnabled = true;
  let motionEasing = 'linear';
  let markers = [];
  let symbols = [];
  let layerClipboard = null;
  let drawingClipboard = null;
  let selectedLayerIds = new Set(['layer-2']);
  let onionSkinEnabled = true;
  let selectionRect = null;
  let selectionStart = null;
  let playbackTimer = null;
  let playbackIndex = 0;
  let recording = false;
  let paintStart = null;
  let transformStartPose = null;

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
      motionTweenEnabled,
      motionEasing,
      onionSkinEnabled,
      markers: markers.map(marker => ({ ...marker })),
      symbols: symbols.map(symbol => ({
        ...symbol,
        frames: symbol.frames.map(frame => frame ? new Uint8ClampedArray(frame) : null),
        keyframes: symbol.keyframes.slice(),
        motion: symbol.motion.map(pose => ({ ...pose }))
      })),
      activeLayerId,
      layers: layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        muted: layer.muted,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        type: layer.type,
        onionSkin: layer.onionSkin,
        ownFps: layer.ownFps,
        fps: layer.fps,
        loopMode: layer.loopMode,
        keyframes: layer.keyframes.slice(0, frameCount),
        motion: layer.motion.slice(0, frameCount).map(pose => ({ ...pose })),
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
      layers = [
        { ...makeLayer('Background', 'background'), locked: true },
        makeLayer('BG', 'bg'),
        makeLayer('Layer 2', 'layer-2')
      ];
      undoStacks = [[]];
      undoMotionStacks = [[]];
      motionTweenEnabled = true;
      motionEasing = 'linear';
      onionSkinEnabled = true;
      onionToggle.checked = true;
      doc.querySelector('#motion-easing').value = motionEasing;
      markers = [];
      symbols = [];
      doc.querySelector('#motion-tween').checked = true;
      activeFrame = 0;
      activeLayerId = 'layer-2';
      selectedLayerIds = new Set([activeLayerId]);
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
      motionTweenEnabled: project.motionTweenEnabled !== false,
      motionEasing: project.motionEasing || 'linear',
      onionSkinEnabled: project.onionSkinEnabled !== false,
      markers: project.markers || [],
      symbols: (project.symbols || []).map(symbol => ({
        id: symbol.id, name: symbol.name,
        frames: symbol.frames.map(frame => frame ? encodePixels(frame) : null),
        keyframes: symbol.keyframes,
        motion: symbol.motion
      })),
      layers: project.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        muted: layer.muted,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        type: layer.type,
        onionSkin: layer.onionSkin,
        ownFps: layer.ownFps,
        fps: layer.fps,
        loopMode: layer.loopMode,
        keyframes: layer.keyframes,
        motion: layer.motion,
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
      const importedLayers = portable.layers.slice(0, 30).map(layer => {
        const frames = Array.from({ length: count }, (_, index) => layer.frames?.[index] ? decodePixels(layer.frames[index]) : null);
        return {
          id: String(layer.id || uuid()),
          name: String(layer.name || 'Layer'),
          visible: layer.visible !== false,
          locked: Boolean(layer.locked),
          muted: Boolean(layer.muted),
          opacity: Number.isFinite(Number(layer.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 1,
          blendMode: ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'lighter'].includes(layer.blendMode) ? layer.blendMode : 'source-over',
          type: ['pixel', 'animation', 'symbol'].includes(layer.type) ? layer.type : 'pixel',
          onionSkin: layer.onionSkin !== false,
          ownFps: Boolean(layer.ownFps),
          fps: Math.max(1, Math.min(60, Number(layer.fps) || 24)),
          loopMode: ['normal', 'once', 'pingpong'].includes(layer.loopMode) ? layer.loopMode : 'normal',
          keyframes: Array.from({ length: count }, (_, index) => Array.isArray(layer.keyframes) ? Boolean(layer.keyframes[index]) : hasPixels(frames[index])),
          motion: Array.from({ length: count }, (_, index) => normalizePose(layer.motion?.[index])),
          frames
        };
      });
      const project = {
        id: uuid(), kind: 'desk-project', name: String(portable.name || file.name.replace(/\.(hefclip|json)$/i, '')),
        createdAt: Date.now(), updatedAt: Date.now(), width: frameWidth, height: frameHeight,
        fps: Number(portable.fps) || 24, frameCount: count,
        motionTweenEnabled: portable.motionTweenEnabled !== false,
        motionEasing: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut', 'sine', 'circular', 'back', 'elastic', 'bounce', 'exponential', 'cubic', 'quartic', 'quintic'].includes(portable.motionEasing) ? portable.motionEasing : 'linear',
        onionSkinEnabled: portable.onionSkinEnabled !== false,
        markers: Array.isArray(portable.markers) ? portable.markers.filter(marker => Number.isInteger(marker.frame) && marker.frame >= 0 && marker.frame < count).map(marker => ({ frame: marker.frame, name: String(marker.name || `Marqueur ${marker.frame + 1}`) })) : [],
        symbols: Array.isArray(portable.symbols) ? portable.symbols.slice(0, 50).filter(symbol => symbol && Array.isArray(symbol.frames) && symbol.frames.length).map(symbol => ({
          id: String(symbol.id || uuid()),
          name: String(symbol.name || 'Symbole'),
          frames: symbol.frames.slice(0, 240).map(frame => frame ? decodePixels(frame) : null),
          keyframes: Array.isArray(symbol.keyframes) ? symbol.keyframes.slice(0, 240).map(Boolean) : [],
          motion: Array.isArray(symbol.motion) ? symbol.motion.slice(0, 240).map(normalizePose) : []
        })) : [],
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
      muted: Boolean(layer.muted),
      opacity: Number.isFinite(Number(layer.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 1,
      blendMode: ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'lighter'].includes(layer.blendMode) ? layer.blendMode : 'source-over',
      type: ['pixel', 'animation', 'symbol'].includes(layer.type) ? layer.type : 'pixel',
      onionSkin: layer.onionSkin !== false,
      ownFps: Boolean(layer.ownFps),
      fps: Math.max(1, Math.min(60, Number(layer.fps) || 24)),
      loopMode: ['normal', 'once', 'pingpong'].includes(layer.loopMode) ? layer.loopMode : 'normal',
      keyframes: Array.from({ length: frameCount }, (_, index) => Array.isArray(layer.keyframes) ? Boolean(layer.keyframes[index]) : hasPixels(layer.frames[index])),
      motion: Array.from({ length: frameCount }, (_, index) => normalizePose(layer.motion?.[index])),
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
    undoMotionStacks = Array.from({ length: frameCount }, () => []);
    motionTweenEnabled = project.motionTweenEnabled !== false;
    motionEasing = project.motionEasing || 'linear';
    onionSkinEnabled = project.onionSkinEnabled !== false;
    onionToggle.checked = onionSkinEnabled;
    doc.querySelector('#motion-easing').value = motionEasing;
    markers = Array.isArray(project.markers) ? project.markers.map(marker => ({ ...marker })) : [];
    symbols = Array.isArray(project.symbols) ? project.symbols.map(symbol => ({
      ...symbol,
      frames: symbol.frames.map(frame => frame ? new Uint8ClampedArray(frame) : null),
      keyframes: Array.isArray(symbol.keyframes) ? symbol.keyframes.slice() : [],
      motion: Array.isArray(symbol.motion) ? symbol.motion.map(pose => ({ ...pose })) : []
    })) : [];
    selectedLayerIds = new Set([activeLayerId]);
    doc.querySelector('#motion-tween').checked = motionTweenEnabled;
    doc.querySelector('#animation-fps').value = String(project.fps || 24);
    doc.querySelector('.desk-document-name').firstChild.textContent = currentProjectName;
    loadDraft();
    activateView('animation');
    refreshTimeline();
    paintFrame(activeFrame);
    doc.querySelector('#animation-status').textContent = 'Projet ouvert.';
  }

  function activeLayer() { return layers.find(layer => layer.id === activeLayerId); }
  function identityPose() { return { x: 0, y: 0, scale: 1, rotation: 0 }; }
  function normalizePose(pose) {
    return {
      x: Number.isFinite(Number(pose?.x)) ? Number(pose.x) : 0,
      y: Number.isFinite(Number(pose?.y)) ? Number(pose.y) : 0,
      scale: Number.isFinite(Number(pose?.scale)) && Number(pose.scale) > 0 ? Number(pose.scale) : 1,
      rotation: Number.isFinite(Number(pose?.rotation)) ? Number(pose.rotation) : 0
    };
  }
  function motionPose(layer, index) {
    const pose = normalizePose(layer.motion[index]);
    if (layer.keyframes[index] || !motionTweenEnabled) return pose;
    const previous = [];
    const next = [];
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (layer.keyframes[frame]) {
        if (frame < index) previous.push(frame);
        else if (frame > index) { next.push(frame); break; }
      }
    }
    const start = previous.at(-1);
    const end = next[0];
    if (start === undefined && end === undefined) return pose;
    if (start === undefined) return normalizePose(layer.motion[end]);
    if (end === undefined) return normalizePose(layer.motion[start]);
    if (!hasPixels(layer.frames[start]) || !hasPixels(layer.frames[end])) return pose;
    const from = normalizePose(layer.motion[start]);
    const to = normalizePose(layer.motion[end]);
    const amount = easeProgress((index - start) / (end - start));
    return {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
      scale: from.scale + (to.scale - from.scale) * amount,
      rotation: from.rotation + (to.rotation - from.rotation) * amount
    };
  }
  function easeProgress(value) {
    const t = Math.min(1, Math.max(0, value));
    if (motionEasing === 'hold') return t < 1 ? 0 : 1;
    if (motionEasing === 'easeIn') return t * t;
    if (motionEasing === 'easeOut') return 1 - (1 - t) ** 2;
    if (motionEasing === 'easeInOut') return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    if (motionEasing === 'sine') return 1 - Math.cos((t * Math.PI) / 2);
    if (motionEasing === 'circular') return 1 - Math.sqrt(1 - t * t);
    if (motionEasing === 'back') return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
    if (motionEasing === 'elastic') return t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    if (motionEasing === 'exponential') return t === 0 ? 0 : 2 ** (10 * t - 10);
    if (motionEasing === 'cubic') return t ** 3;
    if (motionEasing === 'quartic') return t ** 4;
    if (motionEasing === 'quintic') return t ** 5;
    if (motionEasing === 'bounce') {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
    return t;
  }
  function displayedLayerFrame(layer, index) {
    if (layer.type === 'symbol' && layer.ownFps && layer.frames.length > 1) {
      const sceneFps = Number(doc.querySelector('#animation-fps').value) || 24;
      let symbolFrame = Math.floor(index * (Number(layer.fps) || sceneFps) / sceneFps);
      if (layer.loopMode === 'once') symbolFrame = Math.min(layer.frames.length - 1, symbolFrame);
      else if (layer.loopMode === 'pingpong') {
        const cycle = Math.max(1, layer.frames.length * 2 - 2);
        symbolFrame %= cycle;
        if (symbolFrame >= layer.frames.length) symbolFrame = cycle - symbolFrame;
      } else symbolFrame %= layer.frames.length;
      index = symbolFrame;
    }
    if (layer.keyframes[index] || !motionTweenEnabled) return layer.frames[index];
    let previous = index;
    while (previous >= 0 && !layer.keyframes[previous]) previous -= 1;
    let next = index + 1;
    while (next < frameCount && !layer.keyframes[next]) next += 1;
    return previous >= 0 && next < frameCount && hasPixels(layer.frames[previous]) && hasPixels(layer.frames[next])
      ? layer.frames[previous]
      : layer.frames[index];
  }
  function hasPixels(imageData) {
    if (!imageData) return false;
    const pixels = imageData instanceof Uint8ClampedArray ? imageData : imageData.data;
    if (!pixels) return false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]) return true;
    }
    return false;
  }
  function cloneImageData(imageData) {
    const copy = context.createImageData(frameWidth, frameHeight);
    if (imageData) copy.data.set(imageData.data);
    return copy;
  }
  function putLayer(target, data, alpha = 1, pose = identityPose(), layer = null) {
    if (!data) return;
    ghostContext.clearRect(0, 0, frameWidth, frameHeight);
    ghostContext.putImageData(data, 0, 0);
    target.save();
    target.globalAlpha = alpha * (layer?.opacity ?? 1);
    target.globalCompositeOperation = layer?.blendMode || 'source-over';
    target.translate(frameWidth / 2 + pose.x, frameHeight / 2 + pose.y);
    target.rotate(pose.rotation);
    target.scale(pose.scale, pose.scale);
    target.drawImage(ghostCanvas, -frameWidth / 2, -frameHeight / 2);
    target.restore();
  }
  function paintFrame(index, onionSkin = onionToggle.checked, target = context) {
    target.clearRect(0, 0, frameWidth, frameHeight);
    const background = layers.find(layer => layer.id === 'background');
    if (background?.visible && !background.muted) {
      target.save();
      target.globalAlpha = background.opacity ?? 1;
      target.globalCompositeOperation = background.blendMode || 'source-over';
      target.fillStyle = '#ffffff';
      target.fillRect(0, 0, frameWidth, frameHeight);
      target.restore();
    }
    if (onionSkin && onionSkinEnabled && index > 0) {
      layers.filter(layer => layer.visible && !layer.muted && layer.onionSkin !== false).forEach(layer => {
        putLayer(target, displayedLayerFrame(layer, index - 1), 0.16, motionPose(layer, index - 1), layer);
      });
    }
    layers.filter(layer => layer.visible && !layer.muted).forEach(layer => {
      const data = layer.id === activeLayerId && index === activeFrame
        ? draftContext.getImageData(0, 0, frameWidth, frameHeight)
        : displayedLayerFrame(layer, index);
      putLayer(target, data, 1, motionPose(layer, index), layer);
    });
    if (target === context && onionSkin && selectionRect) {
      target.save();
      target.setLineDash([5, 4]);
      target.strokeStyle = '#1769ff';
      target.lineWidth = 1;
      target.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
      target.restore();
    }
  }
  function loadDraft() {
    draftContext.clearRect(0, 0, frameWidth, frameHeight);
    const layer = activeLayer();
    const data = layer && displayedLayerFrame(layer, activeFrame);
    if (data) draftContext.putImageData(data, 0, 0);
  }
  function saveActiveFrame() {
    const layer = activeLayer();
    if (layer && !layer.locked) layer.frames[activeFrame] = draftContext.getImageData(0, 0, frameWidth, frameHeight);
  }
  function markActiveKeyframe() {
    const layer = activeLayer();
    if (!layer || layer.locked) return;
    if (!layer.keyframes[activeFrame]) layer.motion[activeFrame] = motionPose(layer, activeFrame);
    layer.keyframes[activeFrame] = true;
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
      const frameMarkerNames = markers.filter(marker => marker.frame === index).map(marker => marker.name);
      if (frameMarkerNames.length) {
        tick.classList.add('has-marker');
        tick.title = frameMarkerNames.join(', ');
      }
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
      label.className = `layer-label${layer.id === activeLayerId ? ' is-active' : ''}${selectedLayerIds.has(layer.id) ? ' is-selected' : ''}`;
      const choose = doc.createElement('button');
      choose.type = 'button';
      choose.className = 'layer-name';
      choose.textContent = layer.name;
      choose.addEventListener('click', event => {
        if (pathBase) cancelPath();
        saveActiveFrame();
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (selectedLayerIds.has(layer.id) && selectedLayerIds.size > 1) selectedLayerIds.delete(layer.id);
          else selectedLayerIds.add(layer.id);
        } else selectedLayerIds = new Set([layer.id]);
        activeLayerId = layer.id;
        loadDraft();
        paintFrame(activeFrame);
        refreshTimeline();
        scheduleProjectSave();
      });
      choose.addEventListener('dblclick', () => openLayerProperties(layer));
      label.addEventListener('contextmenu', event => {
        event.preventDefault();
        saveActiveFrame();
        activeLayerId = layer.id;
        selectedLayerIds = new Set([layer.id]);
        loadDraft();
        paintFrame(activeFrame);
        refreshTimeline();
        const menu = doc.querySelector('#desk-action-menu');
        menu.hidden = false;
        doc.querySelector('#actions-tab').setAttribute('aria-expanded', 'true');
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
      const mute = doc.createElement('button');
      mute.type = 'button';
      mute.className = 'layer-visibility';
      mute.textContent = layer.muted ? 'M' : 'm';
      mute.title = layer.muted ? 'Réactiver le calque' : 'Rendre le calque muet';
      mute.setAttribute('aria-label', mute.title);
      mute.addEventListener('click', () => {
        saveActiveFrame();
        layer.muted = !layer.muted;
        paintFrame(activeFrame);
        refreshTimeline();
        scheduleProjectSave();
      });
      label.append(choose, visibility, mute);
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
          selectedLayerIds = new Set([activeLayerId]);
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
        cell.className = `timeline-cell${index === activeFrame ? ' is-current' : ''}${hasPixels(layer.frames[index]) ? ' has-drawing' : ''}${layer.keyframes[index] ? ' is-keyframe' : ''}`;
        cell.setAttribute('aria-label', `${layer.name}, image ${index + 1}${layer.keyframes[index] ? ', image clé' : ''}`);
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
    if (pathBase) cancelPath();
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
    const motionStack = undoMotionStacks[activeFrame];
    const layer = activeLayer();
    motionStack.push(layer ? motionPose(layer, activeFrame) : identityPose());
    if (motionStack.length > 30) motionStack.shift();
  }
  function finishStroke() {
    if (!drawing) return;
    drawing = false;
    saveActiveFrame();
    if (hasPixels(draftContext.getImageData(0, 0, frameWidth, frameHeight))) markActiveKeyframe();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  }
  function applyBrushStyle(target, event) {
    const brush = {
      round: { opacity: 1, lineCap: 'round', softness: 0 },
      pencil: { opacity: 0.72, lineCap: 'round', softness: 0 },
      marker: { opacity: 0.48, lineCap: 'square', softness: 0 },
      airbrush: { opacity: 0.28, lineCap: 'round', softness: 0.9 }
    }[activeBrush];
    const pressure = doc.querySelector('#brush-pressure').checked && event.pointerType === 'pen'
      ? Math.max(0.15, event.pressure || 0.5)
      : 1;
    const size = Number(doc.querySelector('#brush-size').value) * pressure;
    target.globalAlpha = brush.opacity * (Number(doc.querySelector('#brush-opacity').value) / 100) * pressure;
    target.lineWidth = size;
    target.lineCap = brush.lineCap;
    target.lineJoin = 'round';
    target.shadowColor = doc.querySelector('#brush-color').value;
    target.shadowBlur = brush.softness * size;
  }
  function resetBrushStyle(target) {
    target.globalAlpha = 1;
    target.shadowBlur = 0;
  }
  function drawPathPreview(endpoint = null, commit = false) {
    if (!pathBase || pathPoints.length === 0) return;
    draftContext.putImageData(pathBase, 0, 0);
    if (pathPoints.length < 2 && !endpoint) {
      paintFrame(activeFrame);
      return;
    }
    draftContext.beginPath();
    draftContext.moveTo(pathPoints[0].x, pathPoints[0].y);
    pathPoints.slice(1).forEach(location => draftContext.lineTo(location.x, location.y));
    if (endpoint && (endpoint.x !== pathPoints[pathPoints.length - 1].x || endpoint.y !== pathPoints[pathPoints.length - 1].y)) {
      draftContext.lineTo(endpoint.x, endpoint.y);
    }
    draftContext.strokeStyle = doc.querySelector('#brush-color').value;
    applyBrushStyle(draftContext, { pointerType: 'mouse', pressure: 0 });
    draftContext.stroke();
    resetBrushStyle(draftContext);
    paintFrame(activeFrame);
    if (commit) {
      pathBase = null;
      pathPoints = [];
      saveActiveFrame();
      markActiveKeyframe();
      refreshTimeline();
      scheduleProjectSave();
    }
  }
  function finishPath() {
    if (!pathBase) return;
    if (pathPoints.length < 2) {
      cancelPath();
      return;
    }
    drawPathPreview(null, true);
  }
  function cancelPath() {
    if (!pathBase) return;
    draftContext.putImageData(pathBase, 0, 0);
    pathBase = null;
    pathPoints = [];
    undoStacks[activeFrame].pop();
    undoMotionStacks[activeFrame].pop();
    paintFrame(activeFrame);
  }
  canvas.addEventListener('pointerdown', event => {
    if (recording || playbackTimer) return;
    const location = point(event);
    if (activeTool === 'eyedropper') {
      paintFrame(activeFrame, false, sampleContext);
      const pixel = sampleContext.getImageData(location.x, location.y, 1, 1).data;
      doc.querySelector('#brush-color').value = `#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      setTool('brush');
      return;
    }
    if (activeLayer()?.locked) return;
    if (activeTool === 'select') {
      selectionStart = location;
      selectionRect = { x: location.x, y: location.y, width: 0, height: 0 };
      canvas.setPointerCapture(event.pointerId);
      paintFrame(activeFrame);
      return;
    }
    if (activeTool === 'cursor') return;
    if (activeTool === 'transform' && !hasPixels(draftContext.getImageData(0, 0, frameWidth, frameHeight))) return;
    if (activeTool === 'path') {
      if (!pathBase) {
        rememberForUndo();
        pathBase = cloneImageData(draftContext.getImageData(0, 0, frameWidth, frameHeight));
        pathPoints = [];
      }
      pathPoints.push(location);
      if (event.detail > 1) finishPath();
      else drawPathPreview();
      event.preventDefault();
      return;
    }
    event.preventDefault();
    rememberForUndo();
    if (activeTool === 'fill') {
      draftContext.fillStyle = doc.querySelector('#brush-color').value;
      draftContext.fillRect(0, 0, frameWidth, frameHeight);
      saveActiveFrame();
      markActiveKeyframe();
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
        markActiveKeyframe();
        paintFrame(activeFrame);
        refreshTimeline();
        scheduleProjectSave();
      }
      return;
    }
    drawing = true;
    paintStart = location;
    canvas.setPointerCapture(event.pointerId);
    if (activeTool === 'transform') {
      const layer = activeLayer();
      transformStartPose = motionPose(layer, activeFrame);
      layer.motion[activeFrame] = { ...transformStartPose };
      markActiveKeyframe();
      return;
    }
    draftContext.beginPath();
    draftContext.moveTo(location.x, location.y);
    draftContext.lineTo(location.x + 0.01, location.y + 0.01);
    draftContext.strokeStyle = activeTool === 'erase' ? 'rgba(0,0,0,1)' : doc.querySelector('#brush-color').value;
    draftContext.globalCompositeOperation = activeTool === 'erase' ? 'destination-out' : 'source-over';
    if (activeTool === 'erase') {
      draftContext.globalAlpha = 1;
      draftContext.lineWidth = Number(doc.querySelector('#brush-size').value);
      draftContext.lineCap = 'round';
      draftContext.lineJoin = 'round';
    } else {
      applyBrushStyle(draftContext, event);
    }
    draftContext.stroke();
    draftContext.globalCompositeOperation = 'source-over';
    resetBrushStyle(draftContext);
    paintFrame(activeFrame);
  });
  canvas.addEventListener('pointermove', event => {
    if (pathBase && activeTool === 'path') {
      drawPathPreview(point(event));
      return;
    }
    if (selectionStart) {
      const location = point(event);
      const x = Math.min(selectionStart.x, location.x);
      const y = Math.min(selectionStart.y, location.y);
      selectionRect = {
        x, y,
        width: Math.abs(location.x - selectionStart.x),
        height: Math.abs(location.y - selectionStart.y)
      };
      paintFrame(activeFrame);
      return;
    }
    if (!drawing) return;
    const location = point(event);
    if (activeTool === 'transform') {
      const layer = activeLayer();
      const startPose = transformStartPose;
      layer.motion[activeFrame] = {
        ...startPose,
        x: startPose.x + location.x - paintStart.x,
        y: startPose.y + location.y - paintStart.y
      };
      paintFrame(activeFrame);
      return;
    }
    draftContext.beginPath();
    draftContext.moveTo(paintStart.x, paintStart.y);
    draftContext.lineTo(location.x, location.y);
    draftContext.strokeStyle = activeTool === 'erase' ? 'rgba(0,0,0,1)' : doc.querySelector('#brush-color').value;
    draftContext.globalCompositeOperation = activeTool === 'erase' ? 'destination-out' : 'source-over';
    if (activeTool === 'erase') {
      draftContext.globalAlpha = 1;
      draftContext.lineWidth = Number(doc.querySelector('#brush-size').value);
      draftContext.lineCap = 'round';
      draftContext.lineJoin = 'round';
    } else {
      applyBrushStyle(draftContext, event);
    }
    draftContext.stroke();
    draftContext.globalCompositeOperation = 'source-over';
    resetBrushStyle(draftContext);
    paintStart = location;
    paintFrame(activeFrame);
  });
  function endCanvasPointer() {
    if (selectionStart) {
      selectionStart = null;
      if (selectionRect && (selectionRect.width < 1 || selectionRect.height < 1)) selectionRect = null;
      return;
    }
    finishStroke();
  }
  canvas.addEventListener('pointerup', endCanvasPointer);
  canvas.addEventListener('pointercancel', endCanvasPointer);
  canvas.addEventListener('dblclick', finishPath);
  canvas.addEventListener('wheel', event => {
    if (activeTool !== 'transform' || recording || playbackTimer || activeLayer()?.locked) return;
    event.preventDefault();
    rememberForUndo();
    const layer = activeLayer();
    const pose = motionPose(layer, activeFrame);
    layer.keyframes[activeFrame] = true;
    if (event.shiftKey) pose.rotation += (event.deltaY < 0 ? -1 : 1) * Math.PI / 36;
    else pose.scale = Math.min(8, Math.max(0.1, pose.scale * (event.deltaY < 0 ? 1.05 : 0.95)));
    layer.motion[activeFrame] = pose;
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.addEventListener('keydown', event => {
    if (activeTool !== 'path' || !pathBase) return;
    if (event.key === 'Enter') { event.preventDefault(); finishPath(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelPath(); }
  });

  function setTool(tool) {
    if (pathBase) cancelPath();
    activeTool = tool;
    doc.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('selected', button.dataset.tool === tool));
    canvas.style.cursor = tool === 'cursor' ? 'default' : tool === 'transform' ? 'move' : 'crosshair';
    doc.querySelector('#animation-status').textContent = tool === 'path'
      ? 'Cliquez pour poser des points, puis double-cliquez ou appuyez sur Entrée pour terminer.'
      : tool === 'transform' ? 'Glissez pour déplacer ; molette pour redimensionner, Maj + molette pour pivoter.' : 'Prêt';
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
  doc.querySelector('#brush-opacity').addEventListener('input', event => {
    doc.querySelector('#brush-opacity-value').value = `${event.target.value} %`;
  });
  doc.querySelectorAll('[data-brush]').forEach(button => button.addEventListener('click', () => {
    activeBrush = button.dataset.brush;
    doc.querySelectorAll('[data-brush]').forEach(preset => preset.setAttribute('aria-pressed', String(preset === button)));
    doc.querySelector('#toggle-brush-library').setAttribute('aria-expanded', 'false');
    doc.querySelector('#brush-library').hidden = true;
  }));
  doc.querySelector('#toggle-brush-library').addEventListener('click', event => {
    const library = doc.querySelector('#brush-library');
    library.hidden = !library.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!library.hidden));
  });
  doc.querySelector('#add-keyframe').addEventListener('click', () => {
    const layer = activeLayer();
    if (!layer || layer.locked || layer.keyframes[activeFrame]) return;
    const pose = motionPose(layer, activeFrame);
    saveActiveFrame();
    if (!hasPixels(layer.frames[activeFrame])) {
      const previous = layer.frames.slice(0, activeFrame).reverse().find(hasPixels);
      if (previous) {
        layer.frames[activeFrame] = cloneImageData(previous);
        draftContext.putImageData(layer.frames[activeFrame], 0, 0);
      }
    }
    layer.motion[activeFrame] = pose;
    layer.keyframes[activeFrame] = true;
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = `Image clé créée à l’image ${activeFrame + 1}.`;
  });
  doc.querySelector('#motion-tween').addEventListener('change', event => {
    motionTweenEnabled = event.currentTarget.checked;
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = motionTweenEnabled
      ? 'Déplacement automatique activé entre les images clés.'
      : 'Déplacement automatique désactivé.';
  });
  doc.querySelector('#animation-fps').addEventListener('change', scheduleProjectSave);
  doc.querySelector('#undo-frame').addEventListener('click', () => {
    const previous = undoStacks[activeFrame].pop();
    if (!previous) return;
    const previousMotion = undoMotionStacks[activeFrame].pop();
    draftContext.putImageData(previous, 0, 0);
    if (previousMotion) activeLayer().motion[activeFrame] = previousMotion;
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.querySelector('#clear-frame').addEventListener('click', () => {
    rememberForUndo();
    draftContext.clearRect(0, 0, frameWidth, frameHeight);
    saveActiveFrame();
    markActiveKeyframe();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.querySelector('#delete-frame').addEventListener('click', () => {
    if (frameCount === 1) return;
    markers = markers.filter(marker => marker.frame !== activeFrame).map(marker => marker.frame > activeFrame ? { ...marker, frame: marker.frame - 1 } : marker);
    layers.forEach(layer => {
      layer.frames.splice(activeFrame, 1);
      layer.keyframes.splice(activeFrame, 1);
      layer.motion.splice(activeFrame, 1);
    });
    undoStacks.splice(activeFrame, 1);
    undoMotionStacks.splice(activeFrame, 1);
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
    markers = markers.map(marker => marker.frame > sourceIndex ? { ...marker, frame: marker.frame + 1 } : marker);
    layers.forEach(layer => {
      const source = layer.frames[sourceIndex];
      layer.frames.splice(sourceIndex + 1, 0, mode === 'drawing' ? null : cloneImageData(source));
      layer.keyframes.splice(sourceIndex + 1, 0, mode === 'duplicate' && layer.keyframes[sourceIndex]);
      layer.motion.splice(sourceIndex + 1, 0, mode === 'drawing' ? identityPose() : normalizePose(layer.motion[sourceIndex]));
    });
    undoStacks.splice(sourceIndex + 1, 0, []);
    undoMotionStacks.splice(sourceIndex + 1, 0, []);
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
    const count = layers.filter(layer => !layer.locked).length + 1;
    addLayerToProject(makeLayer(`Layer ${count + 1}`));
  });
  doc.querySelector('#previous-frame').addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
  doc.querySelector('#timeline-prev').addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
  doc.querySelector('#next-frame').addEventListener('click', () => selectFrame(Math.min(frameCount - 1, activeFrame + 1)));
  doc.querySelector('#timeline-next').addEventListener('click', () => selectFrame(Math.min(frameCount - 1, activeFrame + 1)));
  doc.querySelector('#timeline-scale').addEventListener('input', refreshTimeline);
  doc.querySelector('#onion-skin').addEventListener('change', () => {
    onionSkinEnabled = onionToggle.checked;
    doc.querySelector('#stage-onion').setAttribute('aria-pressed', String(onionToggle.checked));
    paintFrame(activeFrame);
    scheduleProjectSave();
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
    hideActionMenu();
    exportVideo();
  });
  doc.querySelector('#menu-clear-frame').addEventListener('click', () => {
    hideActionMenu();
    doc.querySelector('#clear-frame').click();
  });
  doc.querySelector('#export-frame').addEventListener('click', async () => {
    hideActionMenu();
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
  doc.querySelector('#motion-easing').addEventListener('change', event => {
    motionEasing = event.currentTarget.value;
    paintFrame(activeFrame);
    scheduleProjectSave();
  });
  const propertiesDialog = doc.querySelector('#desk-properties-dialog');
  function applyLayerProperties() {
    const layer = layers.find(item => item.id === propertiesLayerId);
    if (!layer) return;
    layer.type = doc.querySelector('#layer-type').value;
    layer.opacity = Number(doc.querySelector('#layer-opacity').value) / 100;
    layer.blendMode = doc.querySelector('#layer-blend').value;
    layer.muted = doc.querySelector('#layer-muted').checked;
    layer.locked = doc.querySelector('#layer-locked').checked;
    layer.onionSkin = doc.querySelector('#onion-skin-layer').checked;
    layer.ownFps = doc.querySelector('#symbol-own-fps').checked;
    layer.fps = Math.max(1, Math.min(60, Number(doc.querySelector('#symbol-fps').value) || 24));
    layer.loopMode = doc.querySelector('#symbol-loop').value;
    if (layer.locked && activeLayerId === layer.id) {
      const editable = layers.find(item => !item.locked && item.id !== layer.id);
      if (editable) {
        activeLayerId = editable.id;
        selectedLayerIds = new Set([editable.id]);
        loadDraft();
      }
    }
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  }
  propertiesDialog.querySelector('form').addEventListener('input', event => {
    if (event.target.matches('#layer-opacity')) {
      doc.querySelector('#layer-opacity-value').value = `${event.target.value} %`;
    }
    applyLayerProperties();
  });
  propertiesDialog.querySelector('form').addEventListener('change', applyLayerProperties);
  propertiesDialog.addEventListener('close', () => {
    propertiesLayerId = null;
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  function hideActionMenu() {
    doc.querySelector('#desk-action-menu').hidden = true;
    doc.querySelector('#actions-tab').setAttribute('aria-expanded', 'false');
  }
  function selectedLayer() { return layers.find(layer => layer.id === activeLayerId); }
  function addLayerToProject(layer) {
    saveActiveFrame();
    const activeIndex = layers.findIndex(item => item.id === activeLayerId);
    layers.splice(activeIndex + 1, 0, layer);
    activeLayerId = layer.id;
    selectedLayerIds = new Set([layer.id]);
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  }
  function copyDrawing() {
    saveActiveFrame();
    const frame = draftContext.getImageData(0, 0, frameWidth, frameHeight);
    if (selectionRect) {
      for (let y = 0; y < frameHeight; y += 1) {
        for (let x = 0; x < frameWidth; x += 1) {
          if (x < selectionRect.x || x > selectionRect.x + selectionRect.width || y < selectionRect.y || y > selectionRect.y + selectionRect.height) {
            const offset = (y * frameWidth + x) * 4;
            frame.data[offset + 3] = 0;
          }
        }
      }
    }
    drawingClipboard = { imageData: frame, x: 0, y: 0 };
    doc.querySelector('#animation-status').textContent = 'Dessin copié.';
  }
  function pasteDrawing() {
    if (!drawingClipboard || activeLayer()?.locked) return;
    rememberForUndo();
    draftContext.putImageData(cloneImageData(drawingClipboard.imageData), drawingClipboard.x, drawingClipboard.y);
    saveActiveFrame();
    markActiveKeyframe();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = 'Dessin collé.';
  }
  function removeSelectedLayers() {
    const removable = layers.filter(layer => selectedLayerIds.has(layer.id) && !layer.locked);
    if (!removable.length || layers.filter(layer => !layer.locked).length <= removable.length) return;
    layers = layers.filter(layer => !removable.includes(layer));
    const next = layers.find(layer => !layer.locked);
    if (!layers.some(layer => layer.id === activeLayerId)) activeLayerId = next.id;
    selectedLayerIds = new Set([activeLayerId]);
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  }
  function createSymbolFromLayer() {
    const layer = selectedLayer();
    if (!layer) return;
    saveActiveFrame();
    const name = global.prompt('Nom du symbole', layer.name);
    if (name === null) return;
    symbols.push({
      id: uuid(), name: name.trim() || layer.name,
      frames: layer.frames.map(frame => frame ? new Uint8ClampedArray(frame.data) : null),
      keyframes: layer.keyframes.slice(),
      motion: layer.motion.map(pose => ({ ...pose }))
    });
    scheduleProjectSave();
    renderSymbols();
  }
  function renderSymbols() {
    const list = doc.querySelector('#symbol-list');
    list.replaceChildren();
    if (!symbols.length) {
      const empty = doc.createElement('p');
      empty.textContent = 'Aucun symbole enregistré.';
      list.append(empty);
      return;
    }
    symbols.forEach(symbol => {
      const row = doc.createElement('div');
      row.className = 'symbol-row';
      const insert = doc.createElement('button');
      insert.type = 'button';
      insert.textContent = `Ajouter ${symbol.name}`;
      insert.addEventListener('click', () => {
        const layer = makeLayer(symbol.name);
        layer.type = 'symbol';
        layer.ownFps = true;
        layer.frames = Array.from({ length: frameCount }, (_, index) => {
          const pixels = symbol.frames[index % symbol.frames.length];
          if (!pixels) return null;
          const image = context.createImageData(frameWidth, frameHeight);
          image.data.set(pixels instanceof Uint8ClampedArray ? pixels : pixels.data);
          return image;
        });
        layer.keyframes = Array.from({ length: frameCount }, (_, index) => Boolean(symbol.keyframes?.[index % symbol.keyframes.length]));
        layer.motion = Array.from({ length: frameCount }, (_, index) => normalizePose(symbol.motion?.[index % symbol.motion.length]));
        addLayerToProject(layer);
        doc.querySelector('#desk-symbols-dialog').close();
      });
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Supprimer';
      remove.setAttribute('aria-label', `Supprimer le symbole ${symbol.name}`);
      remove.addEventListener('click', () => {
        symbols = symbols.filter(item => item.id !== symbol.id);
        renderSymbols();
        scheduleProjectSave();
      });
      row.append(insert, remove);
      list.append(row);
    });
  }
  function renderMarkers() {
    const list = doc.querySelector('#marker-list');
    const query = doc.querySelector('#marker-search').value.trim().toLocaleLowerCase();
    list.replaceChildren();
    markers.filter(marker => marker.name.toLocaleLowerCase().includes(query)).forEach(marker => {
      const row = doc.createElement('div');
      row.className = 'marker-row';
      const go = doc.createElement('button');
      go.type = 'button';
      go.textContent = `${marker.name} — image ${marker.frame + 1}`;
      go.addEventListener('click', () => {
        selectFrame(marker.frame);
        doc.querySelector('#desk-markers-dialog').close();
      });
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Supprimer le marqueur ${marker.name}`);
      remove.addEventListener('click', () => {
        markers = markers.filter(item => item !== marker);
        renderMarkers();
        scheduleProjectSave();
      });
      row.append(go, remove);
      list.append(row);
    });
  }
  function addMarker() {
    const name = global.prompt('Nom du marqueur', `Marqueur ${activeFrame + 1}`);
    if (name === null) return;
    markers.push({ frame: activeFrame, name: name.trim() || `Marqueur ${activeFrame + 1}` });
    markers.sort((a, b) => a.frame - b.frame);
    renderMarkers();
    refreshTimeline();
    scheduleProjectSave();
  }
  doc.querySelector('#marker-add').addEventListener('click', addMarker);
  doc.querySelector('#marker-search').addEventListener('input', renderMarkers);
  doc.querySelector('#open-markers').addEventListener('click', () => {
    renderMarkers();
    doc.querySelector('#desk-markers-dialog').showModal();
  });
  doc.querySelector('#symbol-create').addEventListener('click', createSymbolFromLayer);
  doc.querySelector('#menu-open-symbols').addEventListener('click', () => {
    hideActionMenu();
    renderSymbols();
    doc.querySelector('#desk-symbols-dialog').showModal();
  });
  doc.querySelector('#menu-copy-drawing').addEventListener('click', () => { copyDrawing(); hideActionMenu(); });
  doc.querySelector('#menu-paste-drawing').addEventListener('click', () => { pasteDrawing(); hideActionMenu(); });
  doc.querySelector('#menu-select-all-layers').addEventListener('click', () => {
    selectedLayerIds = new Set(layers.map(layer => layer.id));
    refreshTimeline();
    hideActionMenu();
  });
  doc.querySelector('#menu-copy-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) layerClipboard = cloneLayer(layer);
    hideActionMenu();
  });
  doc.querySelector('#menu-paste-layer').addEventListener('click', () => {
    if (layerClipboard) addLayerToProject(cloneLayer(layerClipboard, layerClipboard.name));
    hideActionMenu();
  });
  doc.querySelector('#menu-duplicate-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) addLayerToProject(cloneLayer(layer));
    hideActionMenu();
  });
  doc.querySelector('#menu-rename-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) {
      const name = global.prompt('Nom du calque', layer.name);
      if (name !== null && name.trim()) { layer.name = name.trim(); refreshTimeline(); scheduleProjectSave(); }
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-lock-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) {
      layer.locked = !layer.locked;
      if (layer.locked && activeLayerId === layer.id) {
        const editable = layers.find(item => !item.locked);
        if (editable) activeLayerId = editable.id;
      }
      loadDraft();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-layer-properties').addEventListener('click', () => {
    hideActionMenu();
    openLayerProperties();
  });
  doc.querySelector('#menu-rasterize-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) {
      saveActiveFrame();
      const bakedCanvas = doc.createElement('canvas');
      bakedCanvas.width = frameWidth;
      bakedCanvas.height = frameHeight;
      const bakedContext = bakedCanvas.getContext('2d');
      layer.frames = Array.from({ length: frameCount }, (_, index) => {
        bakedContext.clearRect(0, 0, frameWidth, frameHeight);
        putLayer(bakedContext, displayedLayerFrame(layer, index), 1, motionPose(layer, index), layer);
        return bakedContext.getImageData(0, 0, frameWidth, frameHeight);
      });
      layer.opacity = 1;
      layer.blendMode = 'source-over';
      layer.motion = Array.from({ length: frameCount }, identityPose);
      layer.keyframes = layer.frames.map(hasPixels);
      layer.type = 'pixel';
      loadDraft();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-add-drawing').addEventListener('click', () => { hideActionMenu(); insertFrame('drawing'); });
  doc.querySelector('#menu-split-drawing').addEventListener('click', () => {
    const layer = activeLayer();
    if (!layer || layer.locked) { hideActionMenu(); return; }
    saveActiveFrame();
    const newLayer = makeLayer(`${layer.name} — image ${activeFrame + 1}`);
    newLayer.frames[activeFrame] = cloneImageData(layer.frames[activeFrame]);
    newLayer.keyframes[activeFrame] = layer.keyframes[activeFrame];
    newLayer.motion[activeFrame] = normalizePose(layer.motion[activeFrame]);
    layer.frames[activeFrame] = null;
    layer.keyframes[activeFrame] = false;
    layer.motion[activeFrame] = identityPose();
    if (activeLayerId === layer.id) {
      draftContext.clearRect(0, 0, frameWidth, frameHeight);
      layer.frames[activeFrame] = null;
    }
    addLayerToProject(newLayer);
    hideActionMenu();
  });
  doc.querySelector('#menu-create-symbol').addEventListener('click', () => { hideActionMenu(); createSymbolFromLayer(); });
  doc.querySelector('#menu-add-marker').addEventListener('click', () => { hideActionMenu(); addMarker(); });
  doc.querySelector('#menu-delete-selection').addEventListener('click', () => {
    if (selectionRect && !activeLayer()?.locked) {
      rememberForUndo();
      draftContext.clearRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
      selectionRect = null;
      saveActiveFrame();
      markActiveKeyframe();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    } else removeSelectedLayers();
    hideActionMenu();
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
