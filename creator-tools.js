(function (global) {
  'use strict';

  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[index] = value >>> 0;
  }
  function snapCanvasPosition(value) {
    return magneticMode ? Math.round(value / 10) * 10 : value;
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
      id, name, parentId: null, hierarchyEnabled: false, visible: true, locked: false, muted: false, opacity: 1, blendMode: 'source-over',
      type: 'pixel', transformLayer: false, pivotX: frameWidth / 2, pivotY: frameHeight / 2,
      onionSkin: true, lockTransparency: false, fillReference: false, maskEnabled: false,
      ownFps: false, fps: Number(doc.querySelector('#animation-fps').value),
      loopMode: 'normal', frames: Array(frameCount).fill(null), keyframes: Array(frameCount).fill(false),
      motion: Array.from({ length: frameCount }, identityPose)
    };
  }
  function cloneLayer(source, name = `${source.name} copy`) {
    return {
      ...source, id: `layer-${uuid()}`, name, parentId: null, hierarchyEnabled: false,
      frames: source.frames.map(frame => frame ? cloneImageData(frame) : null),
      maskFrames: source.maskFrames?.map(frame => frame ? cloneImageData(frame) : null) || null,
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
      <header class="addon-manager-header">
        <h1 id="addons-title">Addons Maker</h1>
        <nav class="addon-manager-tabs" aria-label="Navigation de l’atelier Minecraft">
          <button type="button" data-addon-tab="creator" aria-selected="true">Creator</button>
          <button type="button" data-addon-tab="addons" aria-selected="false">Addons</button>
          <button type="button" data-addon-tab="showcase" aria-selected="false">Show Case</button>
        </nav>
      </header>
      <section class="addon-manager-panel" id="addon-creator-panel" data-addon-panel="creator">
          <div id="addon-creator-catalog">
            <div class="addon-catalog-toolbar">
              <label for="addon-creator-filter">Filtrer</label>
              <select id="addon-creator-filter" aria-label="Filtrer par type"><option>All</option><option>Objects</option><option>Blocks</option><option>Creatures</option><option>Recipes</option><option>Music discs</option></select>
              <button type="button" class="addon-sort-button" aria-label="Trier par date" title="Trier par date">▣↓</button>
            </div>
            <div class="addon-catalog-grid">
              <button type="button" class="addon-new-card" data-addon-new>
                <span class="addon-new-label">New</span><span class="addon-new-icon" aria-hidden="true">+</span>
              </button>
            </div>
          </div>
          <div id="addon-creator-form" hidden>
          <button type="button" class="addon-back-button" id="addon-back-to-catalog">← Retour aux add-ons</button>
          <section class="addon-type-picker" id="addon-type-picker" aria-labelledby="addon-type-title">
            <h2 id="addon-type-title">Choisir un type de contenu</h2>
            <label class="addon-type-search"><span aria-hidden="true">⌕</span><input id="addon-type-search" type="search" placeholder="Rechercher un type…" aria-label="Rechercher un type de contenu"></label>
            <div class="addon-type-grid" id="addon-type-grid">
              <button type="button" data-addon-choice="menu-group"><span>▦</span>Custom Group</button>
              <button type="button" data-addon-choice="entity"><span>♟</span>Custom Entity</button>
              <button type="button" data-addon-choice="weapon"><span>⚔</span>Custom Weapon</button>
              <button type="button" data-addon-choice="block"><span>▧</span>Custom Block</button>
              <button type="button" data-addon-choice="model-block"><span>⬡</span>Custom Model Block</button>
              <button type="button" data-addon-choice="projectile"><span>➤</span>Custom Projectile</button>
              <button type="button" data-addon-choice="item"><span>◆</span>Custom Item</button>
              <button type="button" data-addon-choice="script"><span>⌘</span>Script</button>
              <button type="button" data-addon-choice="command"><span>›_</span>Custom Command</button>
              <button type="button" data-addon-choice="dimension"><span>◉</span>Custom Dimension</button>
              <button type="button" data-addon-choice="music-disc"><span>♫</span>Music Disc</button>
              <button type="button" data-addon-choice="recipe"><span>▤</span>Recipe</button>
              <button type="button" data-addon-choice="food"><span>✿</span>Food Item</button>
              <button type="button" data-addon-choice="armor"><span>⬟</span>Armor</button>
            </div>
            <p class="addon-type-empty" id="addon-type-empty" hidden>Aucun type ne correspond à cette recherche.</p>
          </section>
          <div id="addon-editor" hidden>
        <p class="eyebrow">Atelier Minecraft</p>
        <h2 class="addon-form-title" id="addon-editor-title">Créez votre add-on</h2>
        <p class="intro tool-intro" id="addon-editor-help">Configurez le contenu puis exportez un pack pour Minecraft Bedrock.</p>
      <div class="addon-layout">
        <form class="addon-form" id="addon-form">
          <div class="addon-fields">
            <div class="field"><label for="addon-kind">Type de contenu</label><select id="addon-kind"><option value="item">Custom Item</option><option value="weapon">Custom Weapon</option><option value="block">Custom Block</option><option value="model-block">Custom Model Block</option><option value="entity">Custom Entity</option><option value="projectile">Custom Projectile</option><option value="menu-group">Custom Menu Group</option><option value="script">Script</option><option value="command">Custom Command (script event)</option><option value="dimension">Custom Dimension (experimental)</option><option value="recipe">Recipe</option><option value="music-disc">Music Disc</option><option value="food">Food Item</option><option value="armor">Armor</option></select></div>
            <div class="field"><label for="addon-name">Nom</label><input id="addon-name" maxlength="40" required value="Cristal solaire"></div>
            <div class="field"><label for="addon-id">Identifiant technique</label><div class="identifier"><span>hefcreative:</span><input id="addon-id" maxlength="32" pattern="[a-z0-9_]+" required value="cristal_solaire" aria-describedby="addon-id-help"></div><small id="addon-id-help">Minuscules, chiffres et tirets bas. Préfixe hefcreative: ajouté à l’export.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="item"><label for="addon-stack">Taille de pile</label><select id="addon-stack"><option>1</option><option>16</option><option selected>64</option></select><label class="check-field"><input id="addon-hand" type="checkbox"> Tenir l’objet comme un outil</label></div>
            <div class="field addon-kind-panel" data-addon-kind="block" hidden><label for="addon-hardness">Résistance à la pioche (secondes)</label><input id="addon-hardness" type="number" min="0" max="3600" step="0.1" value="1.5" required></div>
            <div class="field addon-kind-panel" data-addon-kind="model-block" hidden><label for="addon-hardness-model">Résistance à la pioche (secondes)</label><input id="addon-hardness-model" type="number" min="0" max="3600" step="0.1" value="1.5" required><small>Exporte un bloc expérimental avec géométrie cubique personnalisée.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="entity" hidden><label for="addon-health">Points de vie</label><input id="addon-health" type="number" min="1" max="1024" step="1" value="20" required><small>Crée une créature passive cubique avec un œuf d’apparition.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="weapon" hidden><label for="addon-weapon-damage">Dégâts</label><input id="addon-weapon-damage" type="number" min="1" max="100" value="7" required><label for="addon-weapon-durability">Durabilité</label><input id="addon-weapon-durability" type="number" min="1" max="10000" value="500" required></div>
            <div class="field addon-kind-panel" data-addon-kind="projectile" hidden><label for="addon-projectile-damage">Dégâts du projectile</label><input id="addon-projectile-damage" type="number" min="1" max="100" value="5" required><small>Exporte un objet lanceable et une entité projectile simple. Les mécaniques avancées nécessitent des scripts.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="menu-group" hidden><label for="addon-group-name">Nom du groupe</label><input id="addon-group-name" maxlength="32" value="Mes créations" required><small>Ajoute une catégorie de groupe au menu créatif pour l’objet.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="script" hidden><label for="addon-script-code">Code JavaScript du script</label><textarea id="addon-script-code" rows="9" spellcheck="false" required>import { world } from "@minecraft/server";

world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) event.player.sendMessage("Script HEF Creative actif");
});</textarea><small>Le code est inclus dans le module JavaScript du pack. Vérifiez la compatibilité de l’API avec votre version Bedrock.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="command" hidden><label for="addon-command-message">Réponse de la commande</label><input id="addon-command-message" maxlength="100" value="Commande exécutée !" required><small>Bedrock n’autorise pas l’enregistrement d’une nouvelle commande arbitraire. Le script répond à <code>/scriptevent hefcreative:identifiant</code>.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="dimension" hidden><label for="addon-dimension-generator">Générateur</label><select id="addon-dimension-generator"><option value="overworld">Overworld</option><option value="nether">Nether</option><option value="the_end">The End</option></select><small>La prise en charge des dimensions personnalisées varie selon la version Bedrock et peut nécessiter les fonctionnalités expérimentales. Le pack inclura un modèle à valider avec la version cible.</small></div>
            <div class="field addon-kind-panel" data-addon-kind="food" hidden><label for="addon-food-hunger">Faim restaurée</label><input id="addon-food-hunger" type="number" min="1" max="20" value="4" required><label class="check-field"><input id="addon-food-always" type="checkbox"> Consommable même avec la barre de faim pleine</label></div>
            <div class="field addon-kind-panel" data-addon-kind="armor" hidden><label for="addon-armor-slot">Emplacement</label><select id="addon-armor-slot"><option value="slot.armor.head">Tête</option><option value="slot.armor.chest">Torse</option><option value="slot.armor.legs">Jambes</option><option value="slot.armor.feet">Pieds</option></select><label for="addon-armor-durability">Durabilité</label><input id="addon-armor-durability" type="number" min="1" max="10000" value="300" required></div>
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
        </div>
          </div>
      </section>
      <section class="addon-manager-panel" id="addon-library-panel" data-addon-panel="addons" hidden>
        <div class="addon-catalog-toolbar">
          <label for="addon-catalog-filter">Filtrer</label>
          <select id="addon-catalog-filter" aria-label="Filtrer les add-ons"><option>All</option><option>Objects</option><option>Blocks</option><option>Creatures</option><option>Recipes</option><option>Music discs</option></select>
          <button type="button" class="addon-sort-button" aria-label="Trier par date" title="Trier par date">▣↓</button>
        </div>
        <div class="addon-catalog-grid">
          <button type="button" class="addon-new-card" data-addon-new>
            <span class="addon-new-label">New</span><span class="addon-new-icon" aria-hidden="true">+</span>
          </button>
        </div>
      </section>
      <section class="addon-manager-panel" id="addon-showcase-panel" data-addon-panel="showcase" hidden>
        <div class="addon-catalog-toolbar">
          <label for="addon-showcase-filter">Filtrer</label>
          <select id="addon-showcase-filter" aria-label="Filtrer la vitrine"><option>All</option><option>Objects</option><option>Blocks</option><option>Creatures</option><option>Recipes</option><option>Music discs</option></select>
        </div>
        <div class="addon-catalog-grid">
          <button type="button" class="addon-new-card" data-addon-new>
            <span class="addon-new-label">New</span><span class="addon-new-icon" aria-hidden="true">+</span>
          </button>
        </div>
      </section>
    </section>
    <section class="tool-view animation-view" id="animation-view" hidden aria-label="Animation Desk">
      <header class="desk-topbar">
        <nav class="desk-tabs" aria-label="Navigation Animation Desk"><button type="button" data-home-view aria-label="Retour à l’accueil" title="Retour à l’accueil"><span class="desk-home-icon" aria-hidden="true">⌂</span><span class="desk-home-label">Accueil</span></button><button type="button" id="projects-tab">Projects</button><button type="button" id="library-tab">Library</button><button type="button" id="actions-tab" aria-expanded="false">Actions</button></nav>
        <span class="desk-document-name">Sans titre <span>●</span></span>
        <div class="desk-top-controls"><button class="desk-icon" type="button" id="play-animation" aria-label="Lire l’animation" title="Lire">▶</button><label title="Taille du pinceau"><input id="brush-size" type="range" min="1" max="28" value="5"><output id="brush-size-value">5</output></label><label title="Zoom de la scène"><input id="zoom-control" type="range" min="50" max="150" value="100"></label><button class="desk-export" id="export-video" type="button">Exporter</button></div>
      </header>
      <div class="desk-workspace">
        <nav class="desk-tool-rail" aria-label="Outils de dessin">
          <button type="button" data-tool="cursor" title="Pointeur" aria-label="Pointeur">↖</button><button type="button" data-tool="select" title="Cliquez sur un dessin pour le sélectionner, ou faites glisser pour encadrer une zone" aria-label="Sélectionner un dessin">▧</button><button type="button" data-tool="transform" title="Glisser pour déplacer, molette pour redimensionner, Maj + molette pour pivoter" aria-label="Transformer le calque">⤧</button><span></span><button class="selected" type="button" data-tool="brush" title="Pinceau" aria-label="Pinceau">╱</button><button type="button" data-tool="erase" title="Gomme" aria-label="Gomme">◩</button><button type="button" data-tool="smudge" title="Flou" aria-label="Flou">✋</button><button type="button" data-tool="fill" title="Remplir le calque" aria-label="Remplir le calque">◒</button><button type="button" data-tool="eyedropper" title="Pipette" aria-label="Pipette">⌖</button><button type="button" data-tool="text" title="Texte" aria-label="Texte">T</button><button type="button" data-tool="path" title="Cliquez pour poser les points du tracé, puis double-cliquez ou appuyez sur Entrée" aria-label="Outil de tracé">／</button>
          <button class="desk-tool-bottom" id="undo-frame" type="button" title="Annuler (Ctrl+Z)" aria-label="Annuler">↶</button><button id="redo-frame" type="button" title="Rétablir (Ctrl+Y)" aria-label="Rétablir">↷</button><button id="clear-frame" type="button" title="Effacer l’image" aria-label="Effacer l’image">⌫</button>
        </nav>
        <div class="desk-stage-column">
          <div class="desk-canvas-area"><div class="canvas-matte"><canvas id="drawing-canvas" width="640" height="400" aria-label="Zone de dessin de l’image courante" role="img"></canvas></div></div>
          <div class="desk-stage-bar"><div class="stage-left-controls"><button id="previous-frame" type="button" title="Image précédente" aria-label="Image précédente">|◀</button><button id="next-frame" type="button" title="Image suivante" aria-label="Image suivante">▶|</button><button id="stage-onion" type="button" aria-pressed="true" title="Pelure d’oignon" aria-label="Pelure d’oignon">◐</button><button id="loop-playback" type="button" aria-pressed="true" title="Lecture en boucle" aria-label="Lecture en boucle">⟳</button></div><div class="stage-transport"><button id="stage-to-first" type="button" title="Revenir à la première image" aria-label="Revenir à la première image">≪</button><button id="stage-play" type="button" title="Lire l’animation" aria-label="Lire l’animation">▶</button><button id="stage-to-last" type="button" title="Aller à la dernière image" aria-label="Aller à la dernière image">≫</button></div><span class="stage-scene">Scene 1</span><label class="stage-fps">24 fps <select id="animation-fps" aria-label="Images par seconde"><option>4</option><option>8</option><option>12</option><option>16</option><option selected>24</option></select></label><span id="animation-status" role="status" aria-live="polite">Prêt</span><button id="toggle-timeline-stage" type="button" aria-label="Replier la timeline" title="Replier la timeline">▾</button></div>
        </div>
        <aside class="desk-inspector" aria-label="Réglages"><button type="button" id="color-swatch" title="Choisir une couleur" aria-label="Choisir une couleur"><input id="brush-color" type="color" value="#111111" aria-label="Couleur du pinceau"></button><button type="button" id="toggle-brush-library" aria-label="Choisir un pinceau" aria-expanded="false" title="Choisir un pinceau">≋</button><button type="button" id="toggle-shape-library" aria-label="Choisir une forme" aria-expanded="false" title="Choisir une forme">◇</button><button type="button" id="toggle-layers" aria-label="Afficher les calques" title="Calques">◆</button><button type="button" id="toggle-settings" aria-label="Réglages du pinceau" title="Réglages">☷</button><div class="brush-library" id="brush-library" hidden aria-label="Bibliothèque de pinceaux"><strong>Pinceaux</strong><div class="brush-presets"><button type="button" data-brush="round" aria-pressed="true"><span class="brush-sample sample-round"></span><span>Rond</span></button><button type="button" data-brush="pencil" aria-pressed="false"><span class="brush-sample sample-pencil"></span><span>Crayon</span></button><button type="button" data-brush="marker" aria-pressed="false"><span class="brush-sample sample-marker"></span><span>Marqueur</span></button><button type="button" data-brush="airbrush" aria-pressed="false"><span class="brush-sample sample-airbrush"></span><span>Aérographe</span></button></div></div><div class="shape-library" id="shape-library" hidden aria-label="Bibliothèque de formes"><div class="shape-library-header"><span>Formes</span><button type="button" class="shape-library-close" aria-label="Fermer la bibliothèque de formes">×</button></div><div class="shape-grid"><button type="button" class="shape-card" data-shape="circle" aria-label="Forme cercle"><span class="shape-swatch round"></span><span>Cercle</span></button><button type="button" class="shape-card" data-shape="square" aria-label="Forme carré"><span class="shape-swatch square"></span><span>Carré</span></button><button type="button" class="shape-card" data-shape="triangle" aria-label="Forme triangle"><span class="shape-swatch triangle"></span><span>Triangle</span></button><button type="button" class="shape-card" data-shape="diamond" aria-label="Forme losange"><span class="shape-swatch diamond"></span><span>Losange</span></button><button type="button" class="shape-card" data-shape="star" aria-label="Forme étoile"><span class="shape-swatch star"></span><span>Étoile</span></button><button type="button" class="shape-card" data-shape="heart" aria-label="Forme cœur"><span class="shape-swatch heart"></span><span>Cœur</span></button></div></div><div class="brush-settings" id="brush-settings" hidden><label>Taille <output id="brush-size-side">5 px</output><input id="brush-size-side-control" type="range" min="1" max="28" value="5"></label><label>Opacité <output id="brush-opacity-value">100 %</output><input id="brush-opacity" type="range" min="10" max="100" value="100"></label><label class="brush-check"><input id="brush-pressure" type="checkbox"> Pression du stylet</label><label class="onion-setting"><input id="onion-skin" type="checkbox" checked> Pelure d’oignon</label><label>Nombre de boucles<select id="loop-count"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="5">5</option></select></label><label>Nom du fichier<input id="animation-name" type="text" value="mon-animation" maxlength="40"></label></div><label class="visually-hidden">Épaisseur <output id="brush-size-value-accessible">5 px</output></label></aside>
        <section class="transform-hierarchy-panel" id="transform-hierarchy-panel" aria-label="Transform Hierarchy" hidden>
          <header class="transform-hierarchy-title"><strong>Transform Hierarchy</strong><button type="button" id="close-transform-hierarchy" aria-label="Fermer le panneau">×</button></header>
          <div class="transform-hierarchy-columns">
            <section class="transform-hierarchy-source"><h2>All layers</h2><div id="transform-layer-source"></div></section>
            <section class="transform-hierarchy-target"><h2>Hierarchy</h2><div id="transform-hierarchy-tree" aria-label="Hiérarchie de transformations"></div><p id="transform-hierarchy-empty">Drop layers here to create a transform hierarchy</p></section>
          </div>
          <div class="transform-pivot-controls"><strong>Layer pivot</strong><label>X <input id="transform-pivot-x" type="number" min="0" max="640" step="1"></label><label>Y <input id="transform-pivot-y" type="number" min="0" max="400" step="1"></label></div>
        </section>
      </div>
      <section class="desk-timeline" id="desk-timeline" aria-label="Timeline de l’animation">
        <header class="timeline-topbar"><div class="timeline-top-left"><button type="button" id="toggle-timeline" aria-label="Réduire la timeline" title="Réduire la timeline">⌄</button><strong>Timeline</strong><span id="frame-count">20 images</span></div><div class="timeline-mini-controls"><button type="button" id="timeline-prev" aria-label="Reculer d’une image">◀</button><button type="button" id="timeline-play" aria-label="Lire l’animation">▶</button><button type="button" id="timeline-next" aria-label="Avancer d’une image">▶|</button><button type="button" id="open-markers" title="Rechercher et gérer les marqueurs">Marqueurs</button><select id="motion-easing" aria-label="Courbe d’accélération"><option value="linear">Linéaire</option><option value="hold">Maintien</option><option value="easeIn">Ease In</option><option value="easeOut">Ease Out</option><option value="easeInOut">Ease In Out</option><option value="sine">Sine</option><option value="circular">Circular</option><option value="back">Back</option><option value="elastic">Elastic</option><option value="bounce">Bounce</option><option value="exponential">Exponential</option><option value="cubic">Cubic</option><option value="quartic">Quartic</option><option value="quintic">Quintic</option></select><label title="Zoom de la timeline"><input type="range" min="42" max="100" value="52" id="timeline-scale"></label></div><span class="scene-info">Scene 1 <span>24 fps</span></span></header>
        <div class="timeline-body"><div class="layer-column"><div class="layer-column-heading">Calques <button type="button" id="add-layer" title="Ajouter un calque" aria-label="Ajouter un calque">+</button></div><div id="layer-list"></div></div><div class="track-viewport"><div id="frame-ruler"></div><div id="layer-tracks"></div><div class="frame-commands"><button type="button" id="add-keyframe" title="Créer une image clé sur le calque actif">◆ Image clé</button><label class="motion-tween-control" title="Interpoler position, taille et rotation entre les images clés"><input id="motion-tween" type="checkbox" checked> Déplacement auto</label><button type="button" id="add-frame">＋ Add Drawing</button><button type="button" id="duplicate-frame">⧉ Duplicate</button><button type="button" id="extend-frame">↔ Extend</button><button type="button" id="delete-frame" aria-label="Supprimer l’image sélectionnée">⌫</button></div></div></div>
      </section>
      <div class="desk-action-menu" id="desk-action-menu" hidden><button type="button" id="menu-cut-drawing">Couper</button><button type="button" id="menu-copy-drawing">Copier</button><button type="button" id="menu-paste-drawing">Coller</button><button type="button" id="menu-duplicate-drawing">Dupliquer le dessin</button><button type="button" id="menu-delete-selection">Supprimer</button><hr><button type="button" id="menu-select-all-layers">Sélectionner tous les calques</button><button type="button" id="menu-add-transform-layer">◇ Transform Layer</button><button type="button" id="menu-rename-layer">✎ Renommer</button><button type="button" id="menu-lock-layer">♙ Verrouiller</button><button type="button" id="menu-toggle-layer-onion">◐ Désactiver la pelure d’oignon</button><button type="button" id="menu-copy-layer">▢ Copier</button><button type="button" id="menu-duplicate-layer">▢ Dupliquer</button><button type="button" id="menu-focus-layer">◎ Focus</button><button type="button" id="menu-lock-transparency">▦ Verrouiller la transparence</button><button type="button" id="menu-fill-reference">◈ Définir comme référence de remplissage</button><button type="button" id="menu-layer-mask">▧ Ajouter un masque</button><button type="button" id="menu-layer-properties">Propriétés du calque</button><button type="button" id="menu-paste-layer">Coller le calque</button><button type="button" id="menu-rasterize-layer">▦ Rasteriser</button><button type="button" id="menu-merge-down">⇩ Fusionner vers le bas</button><button type="button" id="menu-create-symbol">◇ Créer un symbole</button><button type="button" id="menu-open-symbols">Symboles</button><button type="button" id="menu-delete-layer">▤ Supprimer le calque</button><button type="button" id="menu-add-drawing">Ajouter un dessin</button><button type="button" id="menu-split-drawing">Séparer le dessin</button><button type="button" id="menu-add-marker">Ajouter un marqueur</button><hr><button type="button" id="menu-export-video">Exporter la vidéo…</button><button type="button" id="export-frame">Exporter l’image PNG</button><button type="button" id="menu-clear-frame">Effacer l’image courante</button></div>
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
      if (activeTool === 'transform' && !layer?.transformLayer && !hasPixels(draftContext.getImageData(0, 0, frameWidth, frameHeight))) return;
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

  function selectAddonTab(name) {
    doc.querySelectorAll('[data-addon-tab]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.addonTab === name));
    });
    doc.querySelectorAll('[data-addon-panel]').forEach(panel => {
      panel.hidden = panel.dataset.addonPanel !== name;
    });
    doc.querySelector('#addon-creator-catalog').hidden = false;
    doc.querySelector('#addon-creator-form').hidden = true;
  }
  doc.querySelectorAll('[data-addon-tab]').forEach(button => {
    button.addEventListener('click', () => selectAddonTab(button.dataset.addonTab));
  });
  doc.querySelectorAll('[data-addon-new]').forEach(button => {
    button.addEventListener('click', () => {
      addonForm.reset();
      addonAudioInput.value = '';
      delete addonId.dataset.edited;
      delete doc.querySelector('#recipe-result').dataset.edited;
      importedAudio = null;
      importedTexture = null;
      updateAddonKind();
      selectAddonTab('creator');
      doc.querySelector('#addon-creator-catalog').hidden = true;
      doc.querySelector('#addon-creator-form').hidden = false;
      doc.querySelector('#addon-type-picker').hidden = false;
      doc.querySelector('#addon-editor').hidden = true;
      doc.querySelector('#addon-type-search').value = '';
      filterAddonChoices('');
      doc.querySelector('#addon-type-search').focus();
    });
  });
  doc.querySelector('#addon-back-to-catalog').addEventListener('click', () => {
    selectAddonTab('creator');
    doc.querySelector('#addon-type-picker').hidden = false;
    doc.querySelector('#addon-editor').hidden = true;
  });
  const addonTypeSearch = doc.querySelector('#addon-type-search');
  function filterAddonChoices(query) {
    const normalizedQuery = query.trim().toLowerCase();
    let visibleCount = 0;
    doc.querySelectorAll('[data-addon-choice]').forEach(button => {
      const visible = button.textContent.toLowerCase().includes(normalizedQuery);
      button.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    doc.querySelector('#addon-type-empty').hidden = visibleCount > 0;
  }
  addonTypeSearch.addEventListener('input', () => filterAddonChoices(addonTypeSearch.value));
  doc.querySelectorAll('[data-addon-choice]').forEach(button => {
    button.addEventListener('click', () => {
      addonKind.value = button.dataset.addonChoice;
      updateAddonKind();
      doc.querySelector('#addon-type-picker').hidden = true;
      doc.querySelector('#addon-editor').hidden = false;
      addonName.focus();
    });
  });
  doc.querySelectorAll('.addon-sort-button').forEach(button => {
    button.addEventListener('click', () => {
      const descending = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(descending));
      button.textContent = descending ? '▣↓' : '▣↑';
      button.title = descending ? 'Plus récent en premier' : 'Plus ancien en premier';
    });
  });

  function updateAddonKind() {
    const kind = addonKind.value;
    const itemTypes = ['item'];
    doc.querySelectorAll('.addon-kind-panel').forEach(panel => {
      const panelKind = panel.dataset.addonKind;
      const visible = panelKind === kind
        || (panelKind === 'item' && itemTypes.includes(kind))
        || (panel.hasAttribute('data-addon-texture') && !['recipe', 'script', 'command', 'dimension'].includes(kind));
      panel.hidden = !visible;
      panel.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = !visible; });
    });
    addonId.value = addonId.value.split(':').pop();
    const labels = {
      item: ['Custom Item', 'Objet Bedrock avec texture personnalisée.'],
      weapon: ['Custom Weapon', 'Objet équipé en main avec dégâts et durabilité.'],
      block: ['Custom Block', 'Bloc cubique destructible avec texture personnalisée.'],
      'model-block': ['Custom Model Block', 'Bloc avec géométrie cubique personnalisée; les modèles complexes requièrent un outil 3D.'],
      entity: ['Custom Entity', 'Créature passive avec œuf d’apparition et modèle cubique.'],
      projectile: ['Custom Projectile', 'Objet lanceable associé à une entité projectile simple.'],
      'menu-group': ['Custom Menu Group', 'Objet ajouté à un groupe du menu créatif.'],
      script: ['Script', 'Module JavaScript Bedrock exporté avec un exemple de script.'],
      command: ['Custom Command', 'Script déclenché par /scriptevent; Bedrock ne permet pas d’enregistrer une commande arbitraire.'],
      dimension: ['Custom Dimension', 'Modèle de dimension expérimental; validez sa compatibilité dans votre version Bedrock.'],
      recipe: ['Recipe', 'Recette Bedrock avec forme précise ou sans forme.'],
      'music-disc': ['Music Disc', 'Disque musical avec audio OGG fourni.'],
      food: ['Food Item', 'Objet consommable avec restauration de faim.'],
      armor: ['Armor', 'Objet portable avec emplacement et durabilité.']
    };
    const [title, help] = labels[kind];
    doc.querySelector('#addon-editor-title').textContent = `Créer : ${title}`;
    doc.querySelector('#addon-editor-help').textContent = help;
    doc.querySelector('#addon-texture-help').textContent = ['block', 'model-block', 'entity'].includes(kind)
      ? 'La texture sera appliquée au bloc ou au modèle cubique.'
      : 'La texture sera convertie en PNG 16 × 16.';
    addonStatus.textContent = help;
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
    const scriptFiles = [];
    let itemAtlas;
    const itemKinds = ['item', 'weapon', 'projectile', 'menu-group', 'food', 'armor'];
    if (itemKinds.includes(kind)) {
      const groupId = `itemGroup.name.hefcreative_${contentId}`;
      const itemComponents = {
        'minecraft:display_name': { value: displayName },
        'minecraft:icon': contentId,
        'minecraft:max_stack_size': kind === 'food' ? 64 : kind === 'item' ? Number(doc.querySelector('#addon-stack').value) : 1,
        'minecraft:hand_equipped': kind === 'weapon' || kind === 'projectile' || (kind === 'item' && doc.querySelector('#addon-hand').checked)
      };
      const menuCategory = { category: kind === 'armor' ? 'equipment' : 'items' };
      if (kind === 'menu-group') {
        menuCategory.group = groupId;
        resourceFiles.push(
          { name: 'texts/languages.json', content: jsonFile(['en_US']) },
          { name: 'texts/en_US.lang', content: `${groupId}=${doc.querySelector('#addon-group-name').value.replace(/[\r\n=]/g, ' ')}\n` }
        );
      }
      if (kind === 'weapon') {
        itemComponents['minecraft:damage'] = { value: Number(doc.querySelector('#addon-weapon-damage').value) };
        itemComponents['minecraft:durability'] = { max_durability: Number(doc.querySelector('#addon-weapon-durability').value) };
      }
      if (kind === 'projectile') {
        const projectileId = `${namespaceId}_projectile`;
        itemComponents['minecraft:throwable'] = { do_swing_animation: true, launch_power_scale: 1, max_draw_duration: 0, scale_power_by_draw_duration: false };
        itemComponents['minecraft:projectile'] = { projectile_entity: projectileId };
        const projectileEntity = {
          format_version: '1.20.80',
          'minecraft:entity': {
            description: { identifier: projectileId, is_spawnable: false, is_summonable: true, is_experimental: false },
            components: {
              'minecraft:type_family': { family: ['hefcreative', 'projectile'] },
              'minecraft:collision_box': { width: 0.25, height: 0.25 },
              'minecraft:physics': {},
              'minecraft:projectile': {
                on_hit: { impact_damage: { damage: Number(doc.querySelector('#addon-projectile-damage').value), knockback: true } },
                power: 1.5, gravity: 0.05, uncertainty_base: 0, anchor: 1
              },
              'minecraft:despawn': { despawn_from_distance: {} }
            }
          }
        };
        behaviorFiles.push({ name: `entities/${contentId}_projectile.json`, content: jsonFile(projectileEntity) });
        const projectileIdentifier = `${namespaceId}_projectile`;
        const projectileGeometryId = `geometry.${contentId}_projectile`;
        resourceFiles.push(
          { name: `entity/${contentId}_projectile.entity.json`, content: jsonFile({
            format_version: '1.10.0',
            'minecraft:client_entity': {
              description: {
                identifier: projectileIdentifier,
                materials: { default: 'entity_alphatest' },
                textures: { default: `textures/entity/${contentId}_projectile` },
                geometry: { default: projectileGeometryId },
                render_controllers: [`controller.render.hefcreative.${contentId}_projectile`]
              }
            }
          }) },
          { name: `models/entity/${contentId}_projectile.geo.json`, content: jsonFile({
            format_version: '1.12.0',
            'minecraft:geometry': [{
              description: { identifier: projectileGeometryId, texture_width: 16, texture_height: 16, visible_bounds_width: 1, visible_bounds_height: 1, visible_bounds_offset: [0, 0.5, 0] },
              bones: [{ name: 'root', pivot: [0, 0, 0], cubes: [{ origin: [-2, -2, -2], size: [4, 4, 4], uv: [0, 0] }] }]
            }]
          }) },
          { name: `textures/entity/${contentId}_projectile.png`, content: textureBytes },
          { name: `render_controllers/${contentId}_projectile.render_controllers.json`, content: jsonFile({
            format_version: '1.8.0',
            render_controllers: { [`controller.render.hefcreative.${contentId}_projectile`]: { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] } }
          }) }
        );
      }
      if (kind === 'food') {
        itemComponents['minecraft:food'] = { nutrition: Number(doc.querySelector('#addon-food-hunger').value), saturation_modifier: 'normal', can_always_eat: doc.querySelector('#addon-food-always').checked };
        itemComponents['minecraft:use_animation'] = 'eat';
        itemComponents['minecraft:use_duration'] = 1.6;
      }
      if (kind === 'armor') {
        itemComponents['minecraft:wearable'] = { slot: doc.querySelector('#addon-armor-slot').value };
        itemComponents['minecraft:durability'] = { max_durability: Number(doc.querySelector('#addon-armor-durability').value) };
      }
      const item = {
        format_version: '1.20.80',
        'minecraft:item': {
          description: { identifier: namespaceId, menu_category: menuCategory },
          components: itemComponents
        }
      };
      behaviorFiles.push({ name: `items/${contentId}.json`, content: jsonFile(item) });
      itemAtlas = { [contentId]: { textures: `textures/items/${contentId}` } };
      resourceFiles.push({ name: `textures/items/${contentId}.png`, content: textureBytes });
    } else if (kind === 'block' || kind === 'model-block') {
      const hardness = Number(doc.querySelector(kind === 'model-block' ? '#addon-hardness-model' : '#addon-hardness').value);
      const localizedName = displayName.replace(/[\r\n]+/g, ' ');
      const blockComponents = {
        'minecraft:material_instances': { '*': { texture: contentId, render_method: 'opaque' } },
        'minecraft:destructible_by_mining': { seconds_to_destroy: hardness },
        'minecraft:destructible_by_explosion': { explosion_resistance: hardness * 3 }
      };
      if (kind === 'model-block') blockComponents['minecraft:geometry'] = `geometry.${contentId}`;
      const block = {
        format_version: '1.20.80',
        'minecraft:block': {
          description: { identifier: namespaceId, menu_category: { category: 'construction' } },
          components: blockComponents
        }
      };
      behaviorFiles.push({ name: `blocks/${contentId}.json`, content: jsonFile(block) });
      const blockResource = { textures: contentId, sound: 'stone' };
      if (kind === 'model-block') blockResource.geometry = `geometry.${contentId}`;
      resourceFiles.push(
        { name: `textures/blocks/${contentId}.png`, content: textureBytes },
        { name: 'textures/terrain_texture.json', content: jsonFile({
          resource_pack_name: displayName,
          texture_name: 'atlas.terrain',
          padding: 8,
          num_mip_levels: 4,
          texture_data: { [contentId]: { textures: `textures/blocks/${contentId}` } }
        }) },
        { name: 'blocks.json', content: jsonFile({ [namespaceId]: blockResource }) },
        { name: 'texts/languages.json', content: jsonFile(['en_US']) },
        { name: 'texts/en_US.lang', content: `tile.${namespaceId}.name=${localizedName}\n` }
      );
      if (kind === 'model-block') {
        const geometry = {
          format_version: '1.12.0',
          'minecraft:geometry': [{
            description: { identifier: `geometry.${contentId}`, texture_width: 16, texture_height: 16, visible_bounds_width: 1, visible_bounds_height: 1, visible_bounds_offset: [0, 0.5, 0] },
            bones: [{ name: 'block', pivot: [0, 0, 0], cubes: [{ origin: [-8, 0, -8], size: [16, 16, 16], uv: [0, 0] }] }]
          }]
        };
        resourceFiles.push({ name: `models/blocks/${contentId}.geo.json`, content: jsonFile(geometry) });
      }
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
    } else if (kind === 'script' || kind === 'command') {
      const responseMessage = doc.querySelector('#addon-command-message').value;
      const scriptSource = kind === 'command'
        ? `import { world } from "@minecraft/server";\n\nworld.afterEvents.scriptEventReceive.subscribe((event) => {\n  if (event.id !== ${JSON.stringify(namespaceId)}) return;\n  world.sendMessage(${JSON.stringify(responseMessage)});\n});\n`
        : doc.querySelector('#addon-script-code').value;
      scriptFiles.push({ name: 'scripts/main.js', content: scriptSource });
    } else if (kind === 'dimension') {
      const dimension = {
        format_version: '1.20.0',
        'minecraft:dimension': {
          description: { identifier: namespaceId },
          components: { 'minecraft:generator': { type: doc.querySelector('#addon-dimension-generator').value } }
        }
      };
      behaviorFiles.push({ name: `dimensions/${contentId}.json`, content: jsonFile(dimension) });
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
    const behaviorModules = [{ description: 'Définitions Bedrock', type: 'data', uuid: uuid(), version }];
    const behaviorDependencies = [{ uuid: resourceUuid, version }];
    if (scriptFiles.length) {
      behaviorModules.push({ description: 'Scripts Bedrock', type: 'script', language: 'javascript', uuid: uuid(), version, entry: 'scripts/main.js' });
      behaviorDependencies.push({ module_name: '@minecraft/server', version: '1.10.0' });
    }
    const behaviorPack = {
      format_version: 2,
      header: { name: `${displayName} — Comportement`, description: `Contenu Bedrock créé avec HEF Creative`, uuid: behaviorUuid, version, min_engine_version: [1, 20, 80] },
      modules: behaviorModules,
      dependencies: behaviorDependencies
    };
    const behaviorPackFiles = [
      { name: 'manifest.json', content: jsonFile(behaviorPack) },
      ...behaviorFiles,
      ...scriptFiles
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
    const limitations = [];
    if (kind === 'command') limitations.push(`Commande personnalisée : Bedrock ne permet pas d’enregistrer une nouvelle commande vanilla. Dans le jeu, utilisez /scriptevent ${namespaceId}.`);
    if (kind === 'dimension') limitations.push('Dimension expérimentale : vérifiez la définition et activez les options expérimentales requises pour votre version Bedrock avant de l’utiliser.');
    if (kind === 'model-block') limitations.push('Modèle de bloc : le pack fournit une géométrie cubique de départ. Les géométries avancées doivent être créées et validées dans un éditeur de modèles Bedrock.');
    if (kind === 'armor') limitations.push('Armure : l’objet portable est défini, mais le modèle visuel porté n’est pas généré; ajoutez vos textures et géométries d’armure.');
    if (kind === 'script' || kind === 'command') limitations.push('Script : activez le pack de comportement et vérifiez la version de @minecraft/server attendue par votre version de Minecraft.');
    return createZip([
      { name: `${baseName}_BP.mcpack`, content: createZip(behaviorPackFiles) },
      { name: `${baseName}_RP.mcpack`, content: createZip(resourcePackFiles) },
      { name: 'README.txt', content: `Contenu Minecraft Bedrock : ${displayName} (${kind}). Ouvrez ce fichier .mcaddon avec Minecraft Bedrock, puis activez les packs de comportement et de ressources dans votre monde.${limitations.length ? `\n\nÀ vérifier :\n- ${limitations.join('\n- ')}` : ''}` }
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
      const typeLabel = doc.querySelector('#addon-kind').selectedOptions[0].textContent;
      status.textContent = `${displayName}.mcaddon est prêt. Ouvrez-le avec Minecraft Bedrock pour importer « ${typeLabel} ». Consultez README.txt pour les limites de compatibilité et les instructions.`;
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
  const magneticButton = doc.createElement('button');
  magneticButton.type = 'button';
  magneticButton.id = 'magnetic-mode';
  magneticButton.className = 'magnetic-mode-button';
  magneticButton.textContent = '🧲 Magnétique';
  magneticButton.title = 'Aimantation des déplacements et des cellules de timeline';
  magneticButton.setAttribute('aria-label', magneticButton.title);
  doc.querySelector('#open-markers').insertAdjacentElement('afterend', magneticButton);
  const layerCell = () => Array(20).fill(null);
  let frameCount = 20;
  let layers = [
    { id: 'background', name: 'Background', parentId: null, hierarchyEnabled: false, transformLayer: false, pivotX: frameWidth / 2, pivotY: frameHeight / 2, visible: true, locked: true, muted: false, opacity: 1, blendMode: 'source-over', type: 'pixel', frames: layerCell(), keyframes: Array(20).fill(false), motion: Array.from({ length: 20 }, identityPose) },
    { id: 'bg', name: 'BG', parentId: null, hierarchyEnabled: false, transformLayer: false, pivotX: frameWidth / 2, pivotY: frameHeight / 2, visible: true, locked: false, muted: false, opacity: 1, blendMode: 'source-over', type: 'pixel', frames: layerCell(), keyframes: Array(20).fill(false), motion: Array.from({ length: 20 }, identityPose) },
    { id: 'layer-2', name: 'Layer 2', parentId: null, hierarchyEnabled: false, transformLayer: false, pivotX: frameWidth / 2, pivotY: frameHeight / 2, visible: true, locked: false, muted: false, opacity: 1, blendMode: 'source-over', type: 'pixel', frames: layerCell(), keyframes: Array(20).fill(false), motion: Array.from({ length: 20 }, identityPose) }
  ];
  let activeLayerId = 'layer-2';
  let undoStacks = Array.from({ length: frameCount }, () => []);
  let undoMotionStacks = Array.from({ length: frameCount }, () => []);
  let undoPivotStacks = Array.from({ length: frameCount }, () => []);
  let redoStacks = Array.from({ length: frameCount }, () => []);
  let redoMotionStacks = Array.from({ length: frameCount }, () => []);
  let redoPivotStacks = Array.from({ length: frameCount }, () => []);
  let activeFrame = 0;
  let drawing = false;
  let activeTool = 'brush';
  let activeBrush = 'round';
  let pathPoints = [];
  let pathBase = null;
  let motionTweenEnabled = true;
  let motionEasing = 'linear';
  let magneticMode = true;
  let timelineDrag = null;
  let markers = [];
  let symbols = [];
  let layerClipboard = null;
  let drawingClipboard = null;
  let selectedLayerIds = new Set(['layer-2']);
  let onionSkinEnabled = true;
  let selectionRect = null;
  let selectionStart = null;
  let selectionMove = null;
  let contextMenuScope = 'scene';
  let soloLayerId = null;
  let soloVisibilityBackup = null;
  let playbackTimer = null;
  let playbackIndex = 0;
  let recording = false;
  let paintStart = null;
  let transformStartPose = null;
  let pivotDragging = false;

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
      magneticMode,
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
        parentId: layer.parentId || null,
        hierarchyEnabled: Boolean(layer.hierarchyEnabled),
        transformLayer: Boolean(layer.transformLayer),
        pivotX: layer.pivotX,
        pivotY: layer.pivotY,
        visible: layer.visible,
        locked: layer.locked,
        muted: layer.muted,
        onionSkin: layer.onionSkin,
        lockTransparency: layer.lockTransparency,
        fillReference: layer.fillReference,
        maskEnabled: layer.maskEnabled,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        type: layer.type,
        ownFps: layer.ownFps,
        fps: layer.fps,
        loopMode: layer.loopMode,
        keyframes: layer.keyframes.slice(0, frameCount),
        motion: layer.motion.slice(0, frameCount).map(pose => ({ ...pose })),
        frames: layer.frames.slice(0, frameCount).map(frame => frame ? new Uint8ClampedArray(frame.data) : null),
        maskFrames: layer.maskFrames?.slice(0, frameCount).map(frame => frame
          ? new Uint8ClampedArray(frame instanceof Uint8ClampedArray ? frame : frame.data)
          : null) || null
      })),
      preview
    };
  }
  async function saveCurrentProject() {
    clearTimeout(projectSaveTimer);
    if (playbackTimer) stopPlayback();
    paintFrame(activeFrame, false, context, false);
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
      undoPivotStacks = [[]];
      redoStacks = [[]];
      redoMotionStacks = [[]];
      redoPivotStacks = [[]];
      motionTweenEnabled = true;
      motionEasing = 'linear';
      magneticMode = true;
      onionSkinEnabled = true;
      onionToggle.checked = true;
      doc.querySelector('#motion-easing').value = motionEasing;
      updateMagneticButton();
      soloLayerId = null;
      soloVisibilityBackup = null;
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
      magneticMode: project.magneticMode !== false,
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
        parentId: layer.parentId,
        hierarchyEnabled: layer.hierarchyEnabled,
        transformLayer: layer.transformLayer,
        pivotX: layer.pivotX,
        pivotY: layer.pivotY,
        visible: layer.visible,
        locked: layer.locked,
        muted: layer.muted,
        lockTransparency: layer.lockTransparency,
        fillReference: layer.fillReference,
        maskEnabled: layer.maskEnabled,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        type: layer.type,
        onionSkin: layer.onionSkin,
        ownFps: layer.ownFps,
        fps: layer.fps,
        loopMode: layer.loopMode,
        keyframes: layer.keyframes,
        motion: layer.motion,
        frames: layer.frames.map(frame => frame ? encodePixels(frame instanceof Uint8ClampedArray ? frame : frame.data) : null),
        maskFrames: layer.maskFrames?.map(frame => frame ? encodePixels(frame instanceof Uint8ClampedArray ? frame : frame.data) : null) || null
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
          parentId: typeof layer.parentId === 'string' ? layer.parentId : null,
          hierarchyEnabled: Boolean(layer.hierarchyEnabled),
          transformLayer: Boolean(layer.transformLayer),
          pivotX: Number.isFinite(Number(layer.pivotX)) ? Math.min(frameWidth, Math.max(0, Number(layer.pivotX))) : frameWidth / 2,
          pivotY: Number.isFinite(Number(layer.pivotY)) ? Math.min(frameHeight, Math.max(0, Number(layer.pivotY))) : frameHeight / 2,
          visible: layer.visible !== false,
          locked: Boolean(layer.locked),
          muted: Boolean(layer.muted),
          onionSkin: layer.onionSkin !== false,
          lockTransparency: Boolean(layer.lockTransparency),
          fillReference: Boolean(layer.fillReference),
          maskEnabled: Boolean(layer.maskEnabled),
          opacity: Number.isFinite(Number(layer.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 1,
          blendMode: ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'lighter'].includes(layer.blendMode) ? layer.blendMode : 'source-over',
          type: ['pixel', 'animation', 'symbol'].includes(layer.type) ? layer.type : 'pixel',
          ownFps: Boolean(layer.ownFps),
          fps: Math.max(1, Math.min(60, Number(layer.fps) || 24)),
          loopMode: ['normal', 'once', 'pingpong'].includes(layer.loopMode) ? layer.loopMode : 'normal',
          keyframes: Array.from({ length: count }, (_, index) => Array.isArray(layer.keyframes) ? Boolean(layer.keyframes[index]) : hasPixels(frames[index])),
          motion: Array.from({ length: count }, (_, index) => normalizePose(layer.motion?.[index])),
          maskFrames: Array.isArray(layer.maskFrames) ? Array.from({ length: count }, (_, index) => layer.maskFrames[index] ? decodePixels(layer.maskFrames[index]) : null) : null,
          frames
        };
      });
      normalizeLayerHierarchy(importedLayers);
      const project = {
        id: uuid(), kind: 'desk-project', name: String(portable.name || file.name.replace(/\.(hefclip|json)$/i, '')),
        createdAt: Date.now(), updatedAt: Date.now(), width: frameWidth, height: frameHeight,
        fps: Number(portable.fps) || 24, frameCount: count,
        motionTweenEnabled: portable.motionTweenEnabled !== false,
        motionEasing: ['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut', 'sine', 'circular', 'back', 'elastic', 'bounce', 'exponential', 'cubic', 'quartic', 'quintic'].includes(portable.motionEasing) ? portable.motionEasing : 'linear',
        magneticMode: portable.magneticMode !== false,
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
      parentId: typeof layer.parentId === 'string' && project.layers.some(parent => parent.id === layer.parentId && parent.id !== layer.id)
        ? layer.parentId
        : null,
      hierarchyEnabled: Boolean(layer.hierarchyEnabled),
      transformLayer: Boolean(layer.transformLayer),
      pivotX: Number.isFinite(Number(layer.pivotX)) ? Math.min(frameWidth, Math.max(0, Number(layer.pivotX))) : frameWidth / 2,
      pivotY: Number.isFinite(Number(layer.pivotY)) ? Math.min(frameHeight, Math.max(0, Number(layer.pivotY))) : frameHeight / 2,
      visible: layer.visible,
      locked: layer.locked,
      muted: Boolean(layer.muted),
      onionSkin: layer.onionSkin !== false,
      lockTransparency: Boolean(layer.lockTransparency),
      fillReference: Boolean(layer.fillReference),
      maskEnabled: Boolean(layer.maskEnabled),
      opacity: Number.isFinite(Number(layer.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 1,
      blendMode: ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'lighter'].includes(layer.blendMode) ? layer.blendMode : 'source-over',
      type: ['pixel', 'animation', 'symbol'].includes(layer.type) ? layer.type : 'pixel',
      ownFps: Boolean(layer.ownFps),
      fps: Math.max(1, Math.min(60, Number(layer.fps) || 24)),
      loopMode: ['normal', 'once', 'pingpong'].includes(layer.loopMode) ? layer.loopMode : 'normal',
      keyframes: Array.from({ length: frameCount }, (_, index) => Array.isArray(layer.keyframes) ? Boolean(layer.keyframes[index]) : hasPixels(layer.frames[index])),
      motion: Array.from({ length: frameCount }, (_, index) => normalizePose(layer.motion?.[index])),
      maskFrames: Array.isArray(layer.maskFrames) ? Array.from({ length: frameCount }, (_, index) => {
        const pixels = layer.maskFrames[index];
        if (!pixels) return null;
        const image = context.createImageData(frameWidth, frameHeight);
        image.data.set(pixels instanceof Uint8ClampedArray ? pixels : pixels.data);
        return image;
      }) : null,
      frames: Array.from({ length: frameCount }, (_, index) => {
        const pixels = layer.frames[index];
        if (!pixels) return null;
        const data = context.createImageData(frameWidth, frameHeight);
        data.data.set(pixels instanceof Uint8ClampedArray ? pixels : pixels.data);
        return data;
      })
    }));
    normalizeLayerHierarchy(layers);
    soloLayerId = null;
    soloVisibilityBackup = null;
    currentProjectId = project.id;
    currentProjectName = project.name;
    currentProjectCreatedAt = project.createdAt;
    activeLayerId = layers.find(layer => layer.id === project.activeLayerId && !layer.locked)?.id || layers.find(layer => !layer.locked)?.id;
    activeFrame = 0;
    undoStacks = Array.from({ length: frameCount }, () => []);
    undoMotionStacks = Array.from({ length: frameCount }, () => []);
    undoPivotStacks = Array.from({ length: frameCount }, () => []);
    redoStacks = Array.from({ length: frameCount }, () => []);
    redoMotionStacks = Array.from({ length: frameCount }, () => []);
    redoPivotStacks = Array.from({ length: frameCount }, () => []);
    motionTweenEnabled = project.motionTweenEnabled !== false;
    motionEasing = project.motionEasing || 'linear';
    magneticMode = project.magneticMode !== false;
    updateMagneticButton();
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
  function layerLocalMatrix(layer, index, pose = motionPose(layer, index)) {
    const cosine = Math.cos(pose.rotation) * pose.scale;
    const sine = Math.sin(pose.rotation) * pose.scale;
    const pivotX = Number.isFinite(layer.pivotX) ? layer.pivotX : frameWidth / 2;
    const pivotY = Number.isFinite(layer.pivotY) ? layer.pivotY : frameHeight / 2;
    return {
      a: cosine, b: sine, c: -sine, d: cosine,
      e: pivotX + pose.x - cosine * pivotX + sine * pivotY,
      f: pivotY + pose.y - sine * pivotX - cosine * pivotY
    };
  }
  function multiplyMatrices(parent, local) {
    return {
      a: parent.a * local.a + parent.c * local.b,
      b: parent.b * local.a + parent.d * local.b,
      c: parent.a * local.c + parent.c * local.d,
      d: parent.b * local.c + parent.d * local.d,
      e: parent.a * local.e + parent.c * local.f + parent.e,
      f: parent.b * local.e + parent.d * local.f + parent.f
    };
  }
  function inverseMatrix(matrix) {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
    const inverse = {
      a: matrix.d / determinant,
      b: -matrix.b / determinant,
      c: -matrix.c / determinant,
      d: matrix.a / determinant
    };
    inverse.e = -(inverse.a * matrix.e + inverse.c * matrix.f);
    inverse.f = -(inverse.b * matrix.e + inverse.d * matrix.f);
    return inverse;
  }
  function transformPoint(matrix, x, y) {
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  }
  function worldLayerMatrix(layer, index, visited = new Set()) {
    const local = layerLocalMatrix(layer, index);
    if (visited.has(layer.id)) return local;
    visited.add(layer.id);
    const parent = layers.find(item => item.id === layer.parentId);
    return parent ? multiplyMatrices(worldLayerMatrix(parent, index, visited), local) : local;
  }
  function localPoseFromMatrix(matrix, layer) {
    const scale = Math.hypot(matrix.a, matrix.b);
    const rotation = Math.atan2(matrix.b, matrix.a);
    const pivotX = layer.pivotX;
    const pivotY = layer.pivotY;
    const transformedPivot = transformPoint(matrix, pivotX, pivotY);
    return normalizePose({
      x: transformedPivot.x - pivotX,
      y: transformedPivot.y - pivotY,
      scale,
      rotation
    });
  }
  function normalizeLayerHierarchy(targetLayers) {
    const byId = new Map(targetLayers.map(layer => [layer.id, layer]));
    targetLayers.forEach(layer => {
      if (!layer.hierarchyEnabled) {
        layer.parentId = null;
        return;
      }
      if (layer.parentId && (!byId.has(layer.parentId) || layer.parentId === layer.id)) {
        layer.parentId = null;
        layer.hierarchyEnabled = false;
        return;
      }
      const visited = new Set([layer.id]);
      let current = layer;
      while (current.parentId) {
        const parent = byId.get(current.parentId);
        if (!parent || visited.has(parent.id)) {
          current.parentId = null;
          break;
        }
        visited.add(parent.id);
        parent.hierarchyEnabled = true;
        current = parent;
      }
    });
  }
  function setLayerPivot(layer, x, y, announce = true, refresh = true) {
    if (!layer || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const nextX = Math.min(frameWidth, Math.max(0, x));
    const nextY = Math.min(frameHeight, Math.max(0, y));
    if (nextX === layer.pivotX && nextY === layer.pivotY) return false;
    const matrices = Array.from({ length: frameCount }, (_, index) => layerLocalMatrix(layer, index));
    layer.pivotX = nextX;
    layer.pivotY = nextY;
    layer.motion = matrices.map(matrix => localPoseFromMatrix(matrix, layer));
    doc.querySelector('#transform-pivot-x').value = String(Math.round(nextX));
    doc.querySelector('#transform-pivot-y').value = String(Math.round(nextY));
    paintFrame(activeFrame);
    if (refresh) refreshTimeline();
    scheduleProjectSave();
    if (announce) doc.querySelector('#animation-status').textContent = `Pivot du calque « ${layer.name} » mis à jour.`;
    return true;
  }
  function setLayerParent(layer, parent, announce = true) {
    if (!layer || parent?.locked || layer === parent) return false;
    const ancestors = new Set();
    for (let ancestor = parent; ancestor && !ancestors.has(ancestor.id); ancestor = layers.find(item => item.id === ancestor.parentId)) {
      ancestors.add(ancestor.id);
      if (ancestor === layer) return false;
    }
    const worldMatrices = Array.from({ length: frameCount }, (_, index) => worldLayerMatrix(layer, index));
    const parentMatrices = parent
      ? Array.from({ length: frameCount }, (_, index) => worldLayerMatrix(parent, index))
      : Array.from({ length: frameCount }, () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }));
    layer.parentId = parent?.id || null;
    layer.hierarchyEnabled = true;
    if (parent) parent.hierarchyEnabled = true;
    layer.motion = worldMatrices.map((world, index) => {
      const inverseParent = inverseMatrix(parentMatrices[index]);
      return inverseParent ? localPoseFromMatrix(multiplyMatrices(inverseParent, world), layer) : motionPose(layer, index);
    });
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    if (announce) {
      doc.querySelector('#animation-status').textContent = parent
        ? `« ${layer.name} » est maintenant enfant de « ${parent.name} ».`
        : `« ${layer.name} » est détaché de sa hiérarchie.`;
    }
    return true;
  }
  function preserveHierarchyBeforeRemoval(removedLayers) {
    const removedIds = new Set(removedLayers.map(layer => layer.id));
    const children = layers.filter(layer => !removedIds.has(layer.id) && removedIds.has(layer.parentId));
    children.forEach(child => {
      let parent = layers.find(layer => layer.id === child.parentId);
      while (parent && removedIds.has(parent.id)) {
        parent = layers.find(layer => layer.id === parent.parentId);
      }
      setLayerParent(child, parent || null, false);
    });
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
  function applyLayerMask(layer, imageData, index) {
    const mask = layer.maskEnabled && layer.maskFrames?.[index];
    if (!mask || !imageData) return imageData;
    const output = cloneImageData(imageData);
    const maskData = mask instanceof Uint8ClampedArray ? mask : mask.data;
    for (let pixel = 0, offset = 0; offset < output.data.length; pixel += 1, offset += 4) {
      output.data[offset + 3] = Math.round(output.data[offset + 3] * maskData[offset + 3] / 255);
    }
    return output;
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
  function putLayer(target, data, alpha = 1, matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, layer = null) {
    if (!data) return;
    ghostContext.clearRect(0, 0, frameWidth, frameHeight);
    ghostContext.putImageData(data, 0, 0);
    target.save();
    target.globalAlpha = alpha * (layer?.opacity ?? 1);
    target.globalCompositeOperation = layer?.blendMode || 'source-over';
    target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    target.drawImage(ghostCanvas, 0, 0);
    target.restore();
  }
  function paintFrame(index, onionSkin = onionToggle.checked, target = context, showGuides = true) {
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
        putLayer(target, applyLayerMask(layer, displayedLayerFrame(layer, index - 1), index - 1), 0.16, worldLayerMatrix(layer, index - 1), layer);
      });
    }
    layers.filter(layer => layer.visible && !layer.muted && (!soloLayerId || soloLayerId === layer.id)).forEach(layer => {
      const data = layer.id === activeLayerId && index === activeFrame
        ? draftContext.getImageData(0, 0, frameWidth, frameHeight)
        : displayedLayerFrame(layer, index);
      putLayer(target, applyLayerMask(layer, data, index), 1, worldLayerMatrix(layer, index), layer);
    });
    if (target === context && onionSkin && selectionRect) {
      if (selectionMove) {
        ghostContext.clearRect(0, 0, frameWidth, frameHeight);
        ghostContext.putImageData(selectionMove.pixels, selectionRect.x, selectionRect.y);
        target.drawImage(ghostCanvas, 0, 0);
      }
      target.save();
      target.setLineDash([5, 4]);
      target.strokeStyle = '#1769ff';
      target.lineWidth = 1;
      target.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
      target.restore();
    }
    if (showGuides && target === context && activeTool === 'transform') {
      const layer = activeLayer();
      if (layer && !layer.locked) {
        const pivot = transformPoint(worldLayerMatrix(layer, index), layer.pivotX, layer.pivotY);
        target.save();
        target.lineWidth = Math.max(1, frameWidth / canvas.getBoundingClientRect().width);
        target.strokeStyle = '#111';
        target.fillStyle = '#f4d35e';
        target.beginPath();
        target.arc(pivot.x, pivot.y, 6, 0, Math.PI * 2);
        target.fill();
        target.stroke();
        target.beginPath();
        target.moveTo(pivot.x - 9, pivot.y);
        target.lineTo(pivot.x + 9, pivot.y);
        target.moveTo(pivot.x, pivot.y - 9);
        target.lineTo(pivot.x, pivot.y + 9);
        target.stroke();
        target.restore();
      }
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
  function updateMagneticButton() {
    magneticButton.setAttribute('aria-pressed', String(magneticMode));
    magneticButton.classList.toggle('is-active', magneticMode);
    magneticButton.textContent = '🧲 Aimant';
    magneticButton.title = magneticMode
      ? 'Mode magnétique activé : grille 10 px, images clés et marqueurs'
      : 'Mode magnétique désactivé';
    magneticButton.setAttribute('aria-label', magneticButton.title);
  }
  function reorderLayer(sourceId, targetId, insertAfter) {
    if (sourceId === targetId) return;
    const sourceIndex = layers.findIndex(layer => layer.id === sourceId);
    if (sourceIndex < 0 || layers[sourceIndex].locked) return;
    const [moving] = layers.splice(sourceIndex, 1);
    let targetIndex = layers.findIndex(layer => layer.id === targetId);
    if (targetIndex < 0) {
      layers.splice(sourceIndex, 0, moving);
      return;
    }
    if (layers[targetIndex].locked) targetIndex = Math.max(0, targetIndex);
    const destination = layers[targetIndex].locked ? targetIndex + 1 : targetIndex + (insertAfter ? 1 : 0);
    layers.splice(destination, 0, moving);
    refreshTimeline();
    paintFrame(activeFrame);
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = `Calque « ${moving.name} » déplacé.`;
  }
  function moveTimelineCel(sourceId, sourceFrame, targetId, requestedFrame) {
    const source = layers.find(layer => layer.id === sourceId);
    const target = layers.find(layer => layer.id === targetId);
    if (!source || !target || source.locked || target.locked || !source.frames[sourceFrame] && !source.keyframes[sourceFrame]) return;
    let targetFrame = requestedFrame;
    if (magneticMode) {
      const anchors = [
        ...markers.map(marker => marker.frame),
        ...target.keyframes.map((isKeyframe, index) => isKeyframe && index !== sourceFrame ? index : -1).filter(index => index >= 0)
      ];
      const anchor = anchors
        .filter(index => index >= 0 && index < frameCount && index !== sourceFrame && Math.abs(index - requestedFrame) <= 1)
        .sort((a, b) => Math.abs(a - requestedFrame) - Math.abs(b - requestedFrame))[0];
      if (anchor !== undefined) targetFrame = anchor;
    }
    if (source === target && sourceFrame === targetFrame) return;
    saveActiveFrame();
    [source.frames[sourceFrame], target.frames[targetFrame]] = [target.frames[targetFrame], source.frames[sourceFrame]];
    [source.keyframes[sourceFrame], target.keyframes[targetFrame]] = [target.keyframes[targetFrame], source.keyframes[sourceFrame]];
    [source.motion[sourceFrame], target.motion[targetFrame]] = [target.motion[targetFrame], source.motion[sourceFrame]];
    if (source.maskFrames || target.maskFrames) {
      source.maskFrames ||= Array(frameCount).fill(null);
      target.maskFrames ||= Array(frameCount).fill(null);
      [source.maskFrames[sourceFrame], target.maskFrames[targetFrame]] = [target.maskFrames[targetFrame], source.maskFrames[sourceFrame]];
    }
    activeLayerId = target.id;
    activeFrame = targetFrame;
    selectedLayerIds = new Set([target.id]);
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = `Dessin déplacé vers ${target.name}, image ${targetFrame + 1}${targetFrame !== requestedFrame ? ' (aimanté)' : ''}.`;
  }
  function startLayerDrag(event, layer) {
    if (layer.locked || event.target.closest('.layer-visibility, .layer-remove')) {
      event.preventDefault();
      return;
    }
    timelineDrag = { type: 'layer', layerId: layer.id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `layer:${layer.id}`);
  }
  function acceptLayerDrop(event, targetLayer) {
    if (timelineDrag?.type !== 'layer') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    reorderLayer(timelineDrag.layerId, targetLayer.id, event.clientY >= bounds.top + bounds.height / 2);
  }
  function openContextMenu(event, scope) {
    event.preventDefault();
    const menu = doc.querySelector('#desk-action-menu');
    contextMenuScope = scope;
    menu.classList.add('is-context-menu');
    const layerActions = ['menu-select-all-layers', 'menu-add-transform-layer', 'menu-copy-layer', 'menu-paste-layer', 'menu-duplicate-layer', 'menu-rename-layer', 'menu-lock-layer', 'menu-toggle-layer-onion', 'menu-focus-layer', 'menu-lock-transparency', 'menu-fill-reference', 'menu-layer-mask', 'menu-layer-properties', 'menu-rasterize-layer', 'menu-merge-down', 'menu-delete-layer'];
    const drawingActions = ['menu-cut-drawing', 'menu-copy-drawing', 'menu-paste-drawing', 'menu-duplicate-drawing', 'menu-add-drawing', 'menu-split-drawing'];
    layerActions.forEach(id => { doc.querySelector(`#${id}`).hidden = scope !== 'layer'; });
    drawingActions.forEach(id => { doc.querySelector(`#${id}`).hidden = scope === 'layer'; });
    doc.querySelector('#menu-create-symbol').hidden = false;
    doc.querySelector('#menu-open-symbols').hidden = scope !== 'layer';
    doc.querySelector('#menu-add-marker').hidden = scope === 'layer';
    doc.querySelector('#menu-export-video').hidden = true;
    doc.querySelector('#export-frame').hidden = scope === 'layer';
    doc.querySelector('#menu-clear-frame').hidden = scope === 'layer';
    if (scope === 'layer') {
      const layer = selectedLayer();
      const toggleLabel = (id, active, onLabel, offLabel) => {
        const button = doc.querySelector(`#${id}`);
        button.textContent = active ? onLabel : offLabel;
      };
      toggleLabel('menu-lock-layer', Boolean(layer?.locked), '♙ Déverrouiller', '♙ Verrouiller');
      toggleLabel('menu-toggle-layer-onion', layer?.onionSkin !== false, '◐ Désactiver la pelure d’oignon', '◐ Activer la pelure d’oignon');
      toggleLabel('menu-focus-layer', soloLayerId === layer?.id, '◎ Quitter le focus', '◎ Focus');
      toggleLabel('menu-lock-transparency', Boolean(layer?.lockTransparency), '▦ Déverrouiller la transparence', '▦ Verrouiller la transparence');
      toggleLabel('menu-fill-reference', Boolean(layer?.fillReference), '◈ Retirer la référence de remplissage', '◈ Définir comme référence de remplissage');
      toggleLabel('menu-layer-mask', Boolean(layer?.maskEnabled), '▧ Désactiver le masque', '▧ Activer le masque');
      toggleLabel('menu-merge-down', false, '⇩ Fusionner vers le bas', '⇩ Fusionner vers le bas');
      doc.querySelector('#menu-merge-down').disabled = !layer || layers[layers.findIndex(item => item.id === layer.id) - 1]?.locked !== false;
      doc.querySelector('#menu-paste-layer').disabled = !layerClipboard;
    } else {
      doc.querySelector('#menu-paste-drawing').disabled = !drawingClipboard;
      doc.querySelector('#menu-paste-layer').disabled = !layerClipboard;
    }
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(event.clientX, global.innerWidth - 248))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, global.innerHeight - 390))}px`;
    doc.querySelector('#actions-tab').setAttribute('aria-expanded', 'true');
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
      label.draggable = !layer.locked;
      label.addEventListener('dragstart', event => startLayerDrag(event, layer));
      label.addEventListener('dragend', () => { timelineDrag = null; });
      label.addEventListener('dragover', event => {
        if (timelineDrag?.type === 'layer') event.preventDefault();
      });
      label.addEventListener('drop', event => acceptLayerDrop(event, layer));
      const choose = doc.createElement('button');
      choose.type = 'button';
      choose.className = 'layer-name';
      choose.textContent = layer.name;
      choose.addEventListener('click', event => {
        if (pathBase) cancelPath();
        selectionRect = null;
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
        selectionRect = null;
        saveActiveFrame();
        activeLayerId = layer.id;
        selectedLayerIds = new Set([layer.id]);
        loadDraft();
        paintFrame(activeFrame);
        refreshTimeline();
        openContextMenu(event, 'layer');
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
          preserveHierarchyBeforeRemoval([layer]);
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
      track.dataset.layerId = layer.id;
      track.addEventListener('dragover', event => {
        if (timelineDrag?.type === 'layer') event.preventDefault();
      });
      track.addEventListener('drop', event => acceptLayerDrop(event, layer));
      track.style.gridTemplateColumns = columns;
      for (let index = 0; index < frameCount; index += 1) {
        const cell = doc.createElement('button');
        cell.type = 'button';
        cell.className = `timeline-cell${index === activeFrame ? ' is-current' : ''}${hasPixels(layer.frames[index]) ? ' has-drawing' : ''}${layer.keyframes[index] ? ' is-keyframe' : ''}`;
        cell.setAttribute('aria-label', `${layer.name}, image ${index + 1}${layer.keyframes[index] ? ', image clé' : ''}`);
        cell.setAttribute('aria-pressed', String(index === activeFrame));
        cell.draggable = !layer.locked && Boolean(layer.frames[index] || layer.keyframes[index]);
        if (cell.draggable) {
          cell.addEventListener('dragstart', event => {
            saveActiveFrame();
            timelineDrag = { type: 'cel', layerId: layer.id, frame: index };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `cel:${layer.id}:${index}`);
          });
          cell.addEventListener('dragend', () => { timelineDrag = null; });
        }
        cell.addEventListener('dragover', event => {
          if (timelineDrag?.type === 'cel' && !layer.locked) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        });
        cell.addEventListener('drop', event => {
          if (timelineDrag?.type !== 'cel') return;
          event.preventDefault();
          event.stopPropagation();
          moveTimelineCel(timelineDrag.layerId, timelineDrag.frame, layer.id, index);
        });
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
        cell.addEventListener('click', () => selectTimelineCell(layer, index));
        cell.addEventListener('contextmenu', event => {
          selectTimelineCell(layer, index);
          openContextMenu(event, 'cel');
        });
        track.append(cell);
      }
      layerTracks.append(track);
    });
    doc.querySelector('#frame-count').textContent = `${activeFrame + 1} / ${frameCount}`;
    renderTransformHierarchy();
  }
  function renderTransformHierarchy() {
    const source = doc.querySelector('#transform-layer-source');
    const tree = doc.querySelector('#transform-hierarchy-tree');
    const empty = doc.querySelector('#transform-hierarchy-empty');
    if (!source || !tree || !empty) return;
    source.replaceChildren();
    tree.replaceChildren();
    layers.forEach(layer => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = `transform-layer-source-item${layer.id === activeLayerId ? ' is-active' : ''}`;
      item.textContent = layer.name;
      item.draggable = !layer.locked;
      item.title = layer.locked ? 'Ce calque est verrouillé' : 'Glissez vers la hiérarchie pour l’ajouter';
      item.addEventListener('click', () => {
        if (layer.locked) return;
        saveActiveFrame();
        activeLayerId = layer.id;
        selectedLayerIds = new Set([layer.id]);
        loadDraft();
        paintFrame(activeFrame);
        refreshTimeline();
      });
      item.addEventListener('dragstart', event => {
        if (layer.locked) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `transform-layer:${layer.id}`);
      });
      source.append(item);
    });
    const renderNode = (layer, depth) => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = `transform-hierarchy-node${layer.id === activeLayerId ? ' is-active' : ''}`;
      item.style.setProperty('--hierarchy-depth', String(depth));
      item.textContent = layer.name;
      item.draggable = !layer.locked;
      item.title = 'Déposez un calque ici pour en faire un enfant';
      item.addEventListener('click', () => {
        if (layer.locked) return;
        saveActiveFrame();
        activeLayerId = layer.id;
        selectedLayerIds = new Set([layer.id]);
        loadDraft();
        paintFrame(activeFrame);
        refreshTimeline();
      });
      item.addEventListener('dragstart', event => {
        if (layer.locked) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `transform-layer:${layer.id}`);
      });
      item.addEventListener('dragover', event => {
        if (Array.from(event.dataTransfer.types).includes('text/plain')) {
          event.preventDefault();
          item.classList.add('is-drop-target');
        }
      });
      item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'));
      item.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        item.classList.remove('is-drop-target');
        const match = /^transform-layer:(.+)$/.exec(event.dataTransfer.getData('text/plain'));
        if (!match) return;
        const child = layers.find(candidate => candidate.id === match[1]);
        if (!setLayerParent(child, layer)) {
          doc.querySelector('#animation-status').textContent = 'Cette relation créerait une hiérarchie invalide.';
        }
      });
      tree.append(item);
      layers.filter(candidate => candidate.parentId === layer.id).forEach(child => renderNode(child, depth + 1));
    };
    const roots = layers.filter(layer => layer.hierarchyEnabled && !layers.some(candidate => candidate.id === layer.parentId && candidate.hierarchyEnabled));
    roots.forEach(layer => renderNode(layer, 0));
    const active = activeLayer();
    doc.querySelector('#transform-pivot-x').value = String(Math.round(active?.pivotX ?? frameWidth / 2));
    doc.querySelector('#transform-pivot-y').value = String(Math.round(active?.pivotY ?? frameHeight / 2));
    tree.ondragover = event => {
      if (Array.from(event.dataTransfer.types).includes('text/plain')) event.preventDefault();
    };
    tree.ondrop = event => {
      if (event.target.closest('.transform-hierarchy-node')) return;
      event.preventDefault();
      const match = /^transform-layer:(.+)$/.exec(event.dataTransfer.getData('text/plain'));
      const layer = match && layers.find(candidate => candidate.id === match[1]);
      if (layer && !setLayerParent(layer, null)) doc.querySelector('#animation-status').textContent = 'Impossible de détacher ce calque.';
    };
    source.ondragover = event => {
      if (Array.from(event.dataTransfer.types).includes('text/plain')) event.preventDefault();
    };
    source.ondrop = event => {
      const match = /^transform-layer:(.+)$/.exec(event.dataTransfer.getData('text/plain'));
      if (!match) return;
      event.preventDefault();
      const layer = layers.find(candidate => candidate.id === match[1]);
      if (!layer?.hierarchyEnabled) return;
      const oldParent = layers.find(candidate => candidate.id === layer.parentId);
      const children = layers.filter(candidate => candidate.parentId === layer.id);
      for (const child of children) setLayerParent(child, oldParent || null, false);
      const worldMatrices = Array.from({ length: frameCount }, (_, index) => worldLayerMatrix(layer, index));
      layer.parentId = null;
      layer.hierarchyEnabled = false;
      layer.motion = worldMatrices.map(matrix => localPoseFromMatrix(matrix, layer));
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    };
    empty.hidden = roots.length > 0;
  }
  function selectFrame(index) {
    if (playbackTimer) stopPlayback();
    if (pathBase) cancelPath();
    selectionRect = null;
    saveActiveFrame();
    activeFrame = index;
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
  }
  function selectTimelineCell(layer, index) {
    if (layer.locked) {
      selectFrame(index);
      return;
    }
    if (playbackTimer) stopPlayback();
    if (pathBase) cancelPath();
    selectionRect = null;
    saveActiveFrame();
    activeFrame = index;
    activeLayerId = layer.id;
    selectedLayerIds = new Set([layer.id]);
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const location = { x: (event.clientX - rect.left) * frameWidth / rect.width, y: (event.clientY - rect.top) * frameHeight / rect.height };
    const layer = activeLayer();
    if (!layer || activeTool === 'transform' || activeTool === 'eyedropper') return location;
    const inverse = inverseMatrix(worldLayerMatrix(layer, activeFrame));
    return inverse ? transformPoint(inverse, location.x, location.y) : location;
  }
  function pointInSelection(location) {
    return selectionRect && location.x >= selectionRect.x && location.x <= selectionRect.x + selectionRect.width
      && location.y >= selectionRect.y && location.y <= selectionRect.y + selectionRect.height;
  }
  function selectionPixelsAt(x, y, width, height) {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(frameWidth, Math.ceil(x + width));
    const bottom = Math.min(frameHeight, Math.ceil(y + height));
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, pixels: draftContext.getImageData(left, top, right - left, bottom - top) };
  }
  function connectedPixelSelection(location) {
    const image = draftContext.getImageData(0, 0, frameWidth, frameHeight);
    const seedX = Math.floor(location.x);
    const seedY = Math.floor(location.y);
    if (seedX < 0 || seedY < 0 || seedX >= frameWidth || seedY >= frameHeight) return null;
    const seedOffset = (seedY * frameWidth + seedX) * 4;
    if (image.data[seedOffset + 3] < 24) return null;
    const seed = Array.from(image.data.slice(seedOffset, seedOffset + 4));
    const visited = new Uint8Array(frameWidth * frameHeight);
    const stack = new Int32Array(frameWidth * frameHeight);
    let top = 0, minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
    const seedIndex = seedY * frameWidth + seedX;
    stack[top++] = seedIndex;
    visited[seedIndex] = 1;
    function queuePixel(pixelIndex) {
      if (pixelIndex >= 0 && !visited[pixelIndex]) {
        visited[pixelIndex] = 1;
        stack[top++] = pixelIndex;
      }
    }
    while (top) {
      const pixelIndex = stack[--top];
      const x = pixelIndex % frameWidth, y = Math.floor(pixelIndex / frameWidth);
      const offset = pixelIndex * 4;
      if (image.data[offset + 3] < 24 ||
          Math.abs(image.data[offset] - seed[0]) > 45 ||
          Math.abs(image.data[offset + 1] - seed[1]) > 45 ||
          Math.abs(image.data[offset + 2] - seed[2]) > 45) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x > 0) queuePixel(pixelIndex - 1);
      if (x + 1 < frameWidth) queuePixel(pixelIndex + 1);
      if (y > 0) queuePixel(pixelIndex - frameWidth);
      if (y + 1 < frameHeight) queuePixel(pixelIndex + frameWidth);
    }
    const componentWidth = maxX - minX + 1, componentHeight = maxY - minY + 1;
    if (componentWidth * componentHeight > frameWidth * frameHeight * 0.75) return null;
    const padding = 8;
    const left = Math.max(0, minX - padding), topEdge = Math.max(0, minY - padding);
    const right = Math.min(frameWidth, maxX + padding + 1), bottom = Math.min(frameHeight, maxY + padding + 1);
    const pixels = draftContext.getImageData(left, topEdge, right - left, bottom - topEdge);
    const source = draftContext.getImageData(0, 0, frameWidth, frameHeight);
    for (let y = topEdge; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) source.data[(y * frameWidth + x) * 4 + 3] = 0;
    }
    return { x: left, y: topEdge, pixels, source };
  }
  function beginSelectionMove(location, selection) {
    if (!selection) return false;
    rememberForUndo();
    if (selection.source) draftContext.putImageData(selection.source, 0, 0);
    else draftContext.clearRect(selection.x, selection.y, selection.pixels.width, selection.pixels.height);
    selectionMove = { pixels: selection.pixels, grabX: location.x - selection.x, grabY: location.y - selection.y };
    selectionRect = { x: selection.x, y: selection.y, width: selection.pixels.width, height: selection.pixels.height };
    return true;
  }
  function ensureLayerMask(layer) {
    if (!layer.maskFrames) {
      layer.maskFrames = Array(frameCount).fill(null);
    }
    if (layer.maskFrames[activeFrame]) return;
    const mask = context.createImageData(frameWidth, frameHeight);
    for (let offset = 0; offset < mask.data.length; offset += 4) {
      mask.data[offset] = mask.data[offset + 1] = mask.data[offset + 2] = mask.data[offset + 3] = 255;
    }
    layer.maskFrames[activeFrame] = mask;
  }
  function rememberForUndo() {
    const stack = undoStacks[activeFrame];
    stack.push(cloneImageData(draftContext.getImageData(0, 0, frameWidth, frameHeight)));
    if (stack.length > 30) stack.shift();
    const motionStack = undoMotionStacks[activeFrame];
    const layer = activeLayer();
    motionStack.push(layer ? motionPose(layer, activeFrame) : identityPose());
    if (motionStack.length > 30) motionStack.shift();
    undoPivotStacks[activeFrame].push(layer ? {
      id: layer.id,
      pivotX: layer.pivotX,
      pivotY: layer.pivotY,
      motion: layer.motion.map(pose => ({ ...pose }))
    } : null);
    if (undoPivotStacks[activeFrame].length > 30) undoPivotStacks[activeFrame].shift();
    redoStacks[activeFrame].length = 0;
    redoMotionStacks[activeFrame].length = 0;
    redoPivotStacks[activeFrame].length = 0;
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
  function drawingCompositeOperation(tool) {
    if (tool === 'erase') return 'destination-out';
    return activeLayer()?.lockTransparency ? 'source-atop' : 'source-over';
  }
  function floodFill(location) {
    const active = activeLayer();
    if (!active || active.locked) return;
    const reference = layers.find(layer => layer.fillReference && layer.visible && !layer.muted) || active;
    const sourceFrame = reference.id === active.id
      ? draftContext.getImageData(0, 0, frameWidth, frameHeight)
      : applyLayerMask(reference, displayedLayerFrame(reference, activeFrame), activeFrame);
    if (!sourceFrame) return;
    const source = sourceFrame.data;
    const seedX = Math.floor(location.x), seedY = Math.floor(location.y);
    if (seedX < 0 || seedY < 0 || seedX >= frameWidth || seedY >= frameHeight) return;
    const seedIndex = seedY * frameWidth + seedX;
    const seedOffset = seedIndex * 4;
    const seed = source.slice(seedOffset, seedOffset + 4);
    const fillColor = doc.querySelector('#brush-color').value;
    const color = [1, 3, 5].map(offset => parseInt(fillColor.slice(offset, offset + 2), 16));
    const tolerance = 32;
    const visited = new Uint8Array(frameWidth * frameHeight);
    const stack = new Int32Array(frameWidth * frameHeight);
    let top = 0;
    stack[top++] = seedIndex;
    visited[seedIndex] = 1;
    const matches = pixelIndex => {
      const offset = pixelIndex * 4;
      if (seed[3] < 12) return source[offset + 3] < 12;
      return source[offset + 3] >= 12 &&
        Math.abs(source[offset] - seed[0]) <= tolerance &&
        Math.abs(source[offset + 1] - seed[1]) <= tolerance &&
        Math.abs(source[offset + 2] - seed[2]) <= tolerance;
    };
    function enqueue(pixelIndex) {
      if (pixelIndex >= 0 && !visited[pixelIndex]) {
        visited[pixelIndex] = 1;
        stack[top++] = pixelIndex;
      }
    }
    const pixels = draftContext.getImageData(0, 0, frameWidth, frameHeight);
    let changed = false;
    while (top) {
      const pixelIndex = stack[--top];
      if (!matches(pixelIndex)) continue;
      const offset = pixelIndex * 4;
      const originalAlpha = pixels.data[offset + 3];
      const fillAlpha = active.lockTransparency ? originalAlpha : 255;
      if (pixels.data[offset] !== color[0] || pixels.data[offset + 1] !== color[1] ||
          pixels.data[offset + 2] !== color[2] || pixels.data[offset + 3] !== fillAlpha) changed = true;
      pixels.data[offset] = color[0];
      pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = fillAlpha;
      const x = pixelIndex % frameWidth, y = Math.floor(pixelIndex / frameWidth);
      if (x > 0) enqueue(pixelIndex - 1);
      if (x + 1 < frameWidth) enqueue(pixelIndex + 1);
      if (y > 0) enqueue(pixelIndex - frameWidth);
      if (y + 1 < frameHeight) enqueue(pixelIndex + frameWidth);
    }
    if (!changed) return;
    rememberForUndo();
    draftContext.putImageData(pixels, 0, 0);
    saveActiveFrame();
    markActiveKeyframe();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
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
    draftContext.globalCompositeOperation = drawingCompositeOperation('brush');
    applyBrushStyle(draftContext, { pointerType: 'mouse', pressure: 0 });
    draftContext.stroke();
    resetBrushStyle(draftContext);
    draftContext.globalCompositeOperation = 'source-over';
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
    undoPivotStacks[activeFrame].pop();
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
    if (activeLayer()?.lockTransparency && activeTool === 'erase') {
      doc.querySelector('#animation-status').textContent = 'Déverrouillez la transparence pour gommer les pixels.';
      return;
    }
    if (activeTool === 'select' || activeTool === 'cursor') {
      if (pointInSelection(location)) {
        const selection = selectionPixelsAt(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        beginSelectionMove(location, selection);
      } else {
        const component = connectedPixelSelection(location);
        if (component) {
          beginSelectionMove(location, component);
        } else {
          selectionRect = null;
          selectionStart = location;
        }
      }
      canvas.setPointerCapture(event.pointerId);
      paintFrame(activeFrame);
      return;
    }
    const layer = activeLayer();
    if (activeTool === 'transform' && layer) {
      const rect = canvas.getBoundingClientRect();
      const pivot = transformPoint(worldLayerMatrix(layer, activeFrame), layer.pivotX, layer.pivotY);
      const hitRadius = 12 * frameWidth / rect.width;
      if (Math.hypot(location.x - pivot.x, location.y - pivot.y) <= hitRadius) {
        rememberForUndo();
        pivotDragging = true;
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (activeTool !== 'transform' && layer?.transformLayer && !['select', 'cursor'].includes(activeTool)) {
      doc.querySelector('#animation-status').textContent = 'Un calque Transform ne contient pas de dessin. Sélectionnez un calque pixel pour dessiner.';
      return;
    }
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
    if (activeTool === 'fill') {
      floodFill(location);
      return;
    }
    rememberForUndo();
    if (activeTool === 'text') {
      const text = global.prompt('Texte à ajouter :');
      if (text) {
        draftContext.fillStyle = doc.querySelector('#brush-color').value;
        draftContext.globalCompositeOperation = drawingCompositeOperation('text');
        draftContext.font = `${Math.max(16, Number(doc.querySelector('#brush-size').value) * 4)}px sans-serif`;
        draftContext.fillText(text, location.x, location.y);
        draftContext.globalCompositeOperation = 'source-over';
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
      if (!layer || layer.locked) return;
      transformStartPose = motionPose(layer, activeFrame);
      layer.motion[activeFrame] = { ...transformStartPose };
      markActiveKeyframe();
      return;
    }
    draftContext.beginPath();
    draftContext.moveTo(location.x, location.y);
    draftContext.lineTo(location.x + 0.01, location.y + 0.01);
    draftContext.strokeStyle = activeTool === 'erase' ? 'rgba(0,0,0,1)' : doc.querySelector('#brush-color').value;
    draftContext.globalCompositeOperation = drawingCompositeOperation(activeTool);
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
  canvas.addEventListener('contextmenu', event => openContextMenu(event, 'scene'));
  canvas.addEventListener('pointermove', event => {
    if (pathBase && activeTool === 'path') {
      drawPathPreview(point(event));
      return;
    }
    if (selectionMove) {
      const location = point(event);
      const x = Math.min(frameWidth - selectionMove.pixels.width, Math.max(0, location.x - selectionMove.grabX));
      const y = Math.min(frameHeight - selectionMove.pixels.height, Math.max(0, location.y - selectionMove.grabY));
      selectionRect = { x, y, width: selectionMove.pixels.width, height: selectionMove.pixels.height };
      paintFrame(activeFrame);
      return;
    }
    if (selectionStart) {
      const location = point(event);
      const x = Math.max(0, Math.min(selectionStart.x, location.x));
      const y = Math.max(0, Math.min(selectionStart.y, location.y));
      selectionRect = {
        x, y,
        width: Math.min(frameWidth - x, Math.abs(location.x - selectionStart.x)),
        height: Math.min(frameHeight - y, Math.abs(location.y - selectionStart.y))
      };
      paintFrame(activeFrame);
      return;
    }
    if (pivotDragging) {
      const layer = activeLayer();
      const inverse = layer && inverseMatrix(worldLayerMatrix(layer, activeFrame));
      if (!layer || !inverse) return;
      const pointerLocation = point(event);
      const location = transformPoint(inverse, pointerLocation.x, pointerLocation.y);
      setLayerPivot(layer, location.x, location.y, false, false);
      return;
    }
    if (!drawing) return;
    const location = point(event);
    if (activeTool === 'transform') {
      const layer = activeLayer();
      const startPose = transformStartPose;
      const parent = layers.find(item => item.id === layer.parentId);
      const parentInverse = parent ? inverseMatrix(worldLayerMatrix(parent, activeFrame)) : null;
      const deltaX = location.x - paintStart.x;
      const deltaY = location.y - paintStart.y;
      const localDelta = parentInverse
        ? { x: parentInverse.a * deltaX + parentInverse.c * deltaY, y: parentInverse.b * deltaX + parentInverse.d * deltaY }
        : { x: deltaX, y: deltaY };
      layer.motion[activeFrame] = {
        ...startPose,
        x: snapCanvasPosition(startPose.x + localDelta.x),
        y: snapCanvasPosition(startPose.y + localDelta.y)
      };
      paintFrame(activeFrame);
      return;
    }
    draftContext.beginPath();
    draftContext.moveTo(paintStart.x, paintStart.y);
    draftContext.lineTo(location.x, location.y);
    draftContext.strokeStyle = activeTool === 'erase' ? 'rgba(0,0,0,1)' : doc.querySelector('#brush-color').value;
    draftContext.globalCompositeOperation = drawingCompositeOperation(activeTool);
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
    if (pivotDragging) {
      pivotDragging = false;
      refreshTimeline();
      scheduleProjectSave();
      return;
    }
    if (selectionMove) {
      draftContext.putImageData(selectionMove.pixels, selectionRect.x, selectionRect.y);
      selectionMove = null;
      saveActiveFrame();
      markActiveKeyframe();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
      return;
    }
    if (selectionStart) {
      selectionStart = null;
      if (selectionRect && (selectionRect.width < 1 || selectionRect.height < 1)) selectionRect = null;
      if (selectionRect) {
        const selection = selectionPixelsAt(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
        if (!selection?.pixels.data.some((value, index) => index % 4 === 3 && value > 0)) selectionRect = null;
      }
      paintFrame(activeFrame);
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
    if (!main.classList.contains('animation-layout-open')) return;
    const menu = doc.querySelector('#desk-action-menu');
    if (event.key === 'Escape' && !menu.hidden && menu.classList.contains('is-context-menu')) {
      hideActionMenu();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (['c', 'x', 'v', 'd'].includes(key) && !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
        event.preventDefault();
        if (key === 'c') copyDrawing();
        else if (key === 'x') cutDrawing();
        else if (key === 'v') pasteDrawing();
        else duplicateDrawing();
        return;
      }
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        doc.querySelector('#redo-frame').click();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        doc.querySelector('#redo-frame').click();
        return;
      }
      if (key === 'z') {
        event.preventDefault();
        doc.querySelector('#undo-frame').click();
        return;
      }
    }
    if (activeTool !== 'path' || !pathBase) return;
    if (event.key === 'Enter') { event.preventDefault(); finishPath(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelPath(); }
  });

  function setTool(tool) {
    if (pathBase) cancelPath();
    activeTool = tool;
    doc.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('selected', button.dataset.tool === tool));
    canvas.style.cursor = tool === 'cursor' || tool === 'select' ? 'default' : tool === 'transform' ? 'move' : 'crosshair';
    doc.querySelector('#animation-status').textContent = tool === 'select' || tool === 'cursor'
      ? 'Cliquez sur un dessin pour le sélectionner et le déplacer, ou faites glisser pour encadrer une zone.'
      : tool === 'path'
      ? 'Cliquez pour poser des points, puis double-cliquez ou appuyez sur Entrée pour terminer.'
      : tool === 'transform' ? 'Glissez pour déplacer ; faites glisser le pivot pour le repositionner, molette pour redimensionner, Maj + molette pour pivoter.' : 'Prêt';
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
    if (!library.hidden) doc.querySelector('#shape-library').hidden = true;
  });
  function closeShapeLibrary() {
    const library = doc.querySelector('#shape-library');
    library.hidden = true;
    doc.querySelector('#toggle-shape-library').setAttribute('aria-expanded', 'false');
  }
  function drawShapeOnCanvas(shapeName) {
    if (activeLayer()?.transformLayer) {
      doc.querySelector('#animation-status').textContent = 'Sélectionnez un calque pixel pour dessiner une forme.';
      return;
    }
    const color = doc.querySelector('#brush-color').value;
    const context = draftContext;
    const centerX = frameWidth / 2;
    const centerY = frameHeight / 2;
    const radius = Math.max(18, Number(doc.querySelector('#brush-size').value) * 4);
    rememberForUndo();
    context.fillStyle = color;
    context.beginPath();
    switch (shapeName) {
      case 'square':
        context.rect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        break;
      case 'triangle':
        context.moveTo(centerX, centerY - radius);
        context.lineTo(centerX + radius, centerY + radius);
        context.lineTo(centerX - radius, centerY + radius);
        context.closePath();
        break;
      case 'diamond':
        context.moveTo(centerX, centerY - radius);
        context.lineTo(centerX + radius, centerY);
        context.lineTo(centerX, centerY + radius);
        context.lineTo(centerX - radius, centerY);
        context.closePath();
        break;
      case 'star': {
        const points = 10;
        for (let index = 0; index < points; index += 1) {
          const angle = (Math.PI / 2) + (index * Math.PI / 5);
          const outward = index % 2 === 0 ? radius : radius * 0.45;
          const x = centerX + Math.cos(angle) * outward;
          const y = centerY + Math.sin(angle) * outward;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        break;
      }
      case 'heart': {
        const left = centerX - radius;
        const top = centerY - radius * 0.8;
        context.moveTo(centerX, centerY + radius * 0.9);
        context.bezierCurveTo(centerX + radius * 1.1, top + radius * 1.1, centerX + radius * 1.7, top + radius * 0.15, centerX, top - radius * 0.75);
        context.bezierCurveTo(centerX - radius * 1.7, top + radius * 0.15, centerX - radius * 1.1, top + radius * 1.1, centerX, centerY + radius * 0.9);
        context.closePath();
        break;
      }
      case 'circle':
      default:
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        break;
    }
    context.fill();
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    closeShapeLibrary();
    setTool('brush');
  }
  doc.querySelector('#toggle-shape-library').addEventListener('click', event => {
    const library = doc.querySelector('#shape-library');
    library.hidden = !library.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!library.hidden));
    if (!library.hidden) doc.querySelector('#brush-library').hidden = true;
  });
  doc.querySelector('.shape-library-close').addEventListener('click', closeShapeLibrary);
  doc.querySelectorAll('[data-shape]').forEach(button => button.addEventListener('click', () => {
    drawShapeOnCanvas(button.dataset.shape);
  }));
  doc.addEventListener('pointerdown', event => {
    if (!event.target.closest('#toggle-shape-library') && !event.target.closest('.shape-library')) {
      closeShapeLibrary();
    }
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
    const previousPivot = undoPivotStacks[activeFrame].pop();
    redoStacks[activeFrame].push(cloneImageData(draftContext.getImageData(0, 0, frameWidth, frameHeight)));
    redoMotionStacks[activeFrame].push(activeLayer() ? normalizePose(activeLayer().motion[activeFrame]) : identityPose());
    const currentLayer = activeLayer();
    redoPivotStacks[activeFrame].push(currentLayer ? {
      id: currentLayer.id,
      pivotX: currentLayer.pivotX,
      pivotY: currentLayer.pivotY,
      motion: currentLayer.motion.map(pose => ({ ...pose }))
    } : null);
    draftContext.putImageData(previous, 0, 0);
    if (previousMotion) activeLayer().motion[activeFrame] = previousMotion;
    if (previousPivot) {
      const layer = layers.find(candidate => candidate.id === previousPivot.id);
      if (layer) {
        layer.pivotX = previousPivot.pivotX;
        layer.pivotY = previousPivot.pivotY;
        layer.motion = previousPivot.motion;
      }
    }
    saveActiveFrame();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
  });
  doc.querySelector('#redo-frame').addEventListener('click', () => {
    const next = redoStacks[activeFrame].pop();
    if (!next) return;
    undoStacks[activeFrame].push(cloneImageData(draftContext.getImageData(0, 0, frameWidth, frameHeight)));
    const nextMotion = redoMotionStacks[activeFrame].pop();
    const nextPivot = redoPivotStacks[activeFrame].pop();
    undoMotionStacks[activeFrame].push(activeLayer() ? motionPose(activeLayer(), activeFrame) : identityPose());
    const currentLayer = activeLayer();
    undoPivotStacks[activeFrame].push(currentLayer ? {
      id: currentLayer.id,
      pivotX: currentLayer.pivotX,
      pivotY: currentLayer.pivotY,
      motion: currentLayer.motion.map(pose => ({ ...pose }))
    } : null);
    draftContext.putImageData(next, 0, 0);
    if (nextMotion && activeLayer()) activeLayer().motion[activeFrame] = nextMotion;
    if (nextPivot) {
      const layer = layers.find(candidate => candidate.id === nextPivot.id);
      if (layer) {
        layer.pivotX = nextPivot.pivotX;
        layer.pivotY = nextPivot.pivotY;
        layer.motion = nextPivot.motion;
      }
    }
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
      layer.maskFrames?.splice(activeFrame, 1);
    });
    undoStacks.splice(activeFrame, 1);
    undoMotionStacks.splice(activeFrame, 1);
    undoPivotStacks.splice(activeFrame, 1);
    redoStacks.splice(activeFrame, 1);
    redoMotionStacks.splice(activeFrame, 1);
    redoPivotStacks.splice(activeFrame, 1);
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
      if (layer.maskFrames) layer.maskFrames.splice(sourceIndex + 1, 0, layer.maskFrames[sourceIndex] ? cloneImageData(layer.maskFrames[sourceIndex]) : null);
    });
    undoStacks.splice(sourceIndex + 1, 0, []);
    undoMotionStacks.splice(sourceIndex + 1, 0, []);
    undoPivotStacks.splice(sourceIndex + 1, 0, []);
    redoStacks.splice(sourceIndex + 1, 0, []);
    redoMotionStacks.splice(sourceIndex + 1, 0, []);
    redoPivotStacks.splice(sourceIndex + 1, 0, []);
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
  doc.querySelector('#menu-add-transform-layer').addEventListener('click', () => {
    const layer = makeLayer('Transform Layer');
    layer.transformLayer = true;
    layer.hierarchyEnabled = true;
    addLayerToProject(layer);
    setTool('transform');
    const panel = doc.querySelector('#transform-hierarchy-panel');
    panel.hidden = false;
    hierarchyToggle.setAttribute('aria-expanded', 'true');
    hideActionMenu();
    doc.querySelector('#animation-status').textContent = 'Transform Layer créé. Glissez des calques dans le panneau Hierarchy pour les rattacher.';
  });
  doc.querySelector('#previous-frame').addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
  doc.querySelector('#timeline-prev').addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
  doc.querySelector('#next-frame').addEventListener('click', () => selectFrame(Math.min(frameCount - 1, activeFrame + 1)));
  doc.querySelector('#timeline-next').addEventListener('click', () => selectFrame(Math.min(frameCount - 1, activeFrame + 1)));
  doc.querySelector('#timeline-scale').addEventListener('input', refreshTimeline);
  magneticButton.addEventListener('click', () => {
    magneticMode = !magneticMode;
    updateMagneticButton();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = magneticMode
      ? 'Mode magnétique activé : grille 10 px, images clés et marqueurs.'
      : 'Mode magnétique désactivé.';
  });
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
  const hierarchyToggle = doc.querySelector('#toggle-layers');
  hierarchyToggle.title = 'Transform Hierarchy';
  hierarchyToggle.setAttribute('aria-label', 'Afficher la hiérarchie de transformations');
  hierarchyToggle.setAttribute('aria-controls', 'transform-hierarchy-panel');
  hierarchyToggle.setAttribute('aria-expanded', 'false');
  hierarchyToggle.addEventListener('click', () => {
    doc.querySelector('#desk-timeline').classList.remove('is-collapsed');
    const panel = doc.querySelector('#transform-hierarchy-panel');
    panel.hidden = !panel.hidden;
    hierarchyToggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  doc.querySelector('#close-transform-hierarchy').addEventListener('click', () => {
    doc.querySelector('#transform-hierarchy-panel').hidden = true;
    hierarchyToggle.setAttribute('aria-expanded', 'false');
  });
  doc.querySelector('#transform-pivot-x').addEventListener('change', event => {
    const layer = activeLayer();
    if (!layer) return;
    rememberForUndo();
    setLayerPivot(layer, Number(event.currentTarget.value), layer.pivotY);
  });
  doc.querySelector('#transform-pivot-y').addEventListener('change', event => {
    const layer = activeLayer();
    if (!layer) return;
    rememberForUndo();
    setLayerPivot(layer, layer.pivotX, Number(event.currentTarget.value));
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
    menu.classList.remove('is-context-menu');
    menu.style.left = '';
    menu.style.top = '';
    menu.querySelectorAll('button').forEach(button => { button.hidden = false; });
    menu.hidden = !menu.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
  });
  doc.addEventListener('pointerdown', event => {
    const menu = doc.querySelector('#desk-action-menu');
    if (!menu.hidden && menu.classList.contains('is-context-menu') &&
        !menu.contains(event.target) && event.target !== canvas && !event.target.closest('.layer-label, .timeline-cell')) {
      hideActionMenu();
    }
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
    paintFrame(playbackIndex, false, context, false);
    playbackTimer = setInterval(() => {
      const nextIndex = playbackIndex + 1;
      if (nextIndex >= frameCount) {
        if (doc.querySelector('#loop-playback').getAttribute('aria-pressed') === 'true') playbackIndex = 0;
        else { stopPlayback(); return; }
      } else playbackIndex = nextIndex;
      paintFrame(playbackIndex, false, context, false);
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
    const menu = doc.querySelector('#desk-action-menu');
    menu.hidden = true;
    menu.classList.remove('is-context-menu');
    menu.style.left = '';
    menu.style.top = '';
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
    if (activeLayer()?.transformLayer) {
      doc.querySelector('#animation-status').textContent = 'Un calque Transform ne contient pas de dessin à copier.';
      return false;
    }
    saveActiveFrame();
    const area = selectionRect
      ? selectionPixelsAt(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height)
      : { x: 0, y: 0, pixels: draftContext.getImageData(0, 0, frameWidth, frameHeight) };
    if (!area) return false;
    drawingClipboard = { imageData: area.pixels, x: area.x, y: area.y };
    doc.querySelector('#animation-status').textContent = selectionRect ? 'Sélection copiée.' : 'Dessin copié.';
    return true;
  }
  function cutDrawing() {
    if (!copyDrawing() || activeLayer()?.locked) return;
    rememberForUndo();
    if (selectionRect) draftContext.clearRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
    else draftContext.clearRect(0, 0, frameWidth, frameHeight);
    saveActiveFrame();
    markActiveKeyframe();
    selectionRect = null;
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = 'Dessin coupé.';
  }
  function pasteDrawing() {
    if (activeLayer()?.transformLayer) {
      doc.querySelector('#animation-status').textContent = 'Sélectionnez un calque pixel pour coller le dessin.';
      return;
    }
    if (!drawingClipboard || activeLayer()?.locked) return;
    rememberForUndo();
    const targetX = selectionRect ? selectionRect.x : drawingClipboard.x;
    const targetY = selectionRect ? selectionRect.y : drawingClipboard.y;
    draftContext.putImageData(drawingClipboard.imageData, targetX, targetY);
    selectionRect = { x: targetX, y: targetY, width: drawingClipboard.imageData.width, height: drawingClipboard.imageData.height };
    saveActiveFrame();
    markActiveKeyframe();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = 'Dessin collé.';
  }
  function duplicateDrawing() {
    if (!copyDrawing() || activeLayer()?.locked) return;
    const originalX = drawingClipboard.x, originalY = drawingClipboard.y;
    const width = drawingClipboard.imageData.width, height = drawingClipboard.imageData.height;
    const offset = magneticMode ? 10 : 1;
    const x = Math.min(Math.max(0, frameWidth - width), originalX + offset);
    const y = Math.min(Math.max(0, frameHeight - height), originalY + offset);
    drawingClipboard.x = x;
    drawingClipboard.y = y;
    selectionRect = { x, y, width, height };
    pasteDrawing();
    doc.querySelector('#animation-status').textContent = 'Dessin dupliqué.';
  }
  function removeSelectedLayers() {
    const removable = layers.filter(layer => selectedLayerIds.has(layer.id) && !layer.locked);
    if (!removable.length || layers.filter(layer => !layer.locked).length <= removable.length) return;
    preserveHierarchyBeforeRemoval(removable);
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
  doc.querySelector('#menu-cut-drawing').addEventListener('click', () => { cutDrawing(); hideActionMenu(); });
  doc.querySelector('#menu-duplicate-drawing').addEventListener('click', () => { duplicateDrawing(); hideActionMenu(); });
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
  doc.querySelector('#menu-toggle-layer-onion').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) {
      layer.onionSkin = layer.onionSkin === false;
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-focus-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (!layer) { hideActionMenu(); return; }
    if (soloLayerId === layer.id) {
      soloVisibilityBackup?.forEach((visible, id) => {
        const item = layers.find(candidate => candidate.id === id);
        if (item) item.visible = visible;
      });
      soloLayerId = null;
      soloVisibilityBackup = null;
    } else {
      soloVisibilityBackup = new Map(layers.map(item => [item.id, item.visible]));
      soloLayerId = layer.id;
    }
    paintFrame(activeFrame);
    refreshTimeline();
    hideActionMenu();
  });
  doc.querySelector('#menu-lock-transparency').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer && !layer.locked) {
      layer.lockTransparency = !layer.lockTransparency;
      scheduleProjectSave();
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-fill-reference').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) {
      layer.fillReference = !layer.fillReference;
      if (layer.fillReference) layers.filter(item => item !== layer).forEach(item => { item.fillReference = false; });
      doc.querySelector('#animation-status').textContent = layer.fillReference
        ? `« ${layer.name} » est le calque de référence du remplissage.`
        : 'Calque de référence du remplissage désactivé.';
      refreshTimeline();
      scheduleProjectSave();
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-layer-mask').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer && !layer.locked) {
      ensureLayerMask(layer);
      layer.maskEnabled = !layer.maskEnabled;
      paintFrame(activeFrame);
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
      preserveHierarchyBeforeRemoval([layer]);
      const bakedCanvas = doc.createElement('canvas');
      bakedCanvas.width = frameWidth;
      bakedCanvas.height = frameHeight;
      const bakedContext = bakedCanvas.getContext('2d');
      layer.frames = Array.from({ length: frameCount }, (_, index) => {
        bakedContext.clearRect(0, 0, frameWidth, frameHeight);
        putLayer(bakedContext, applyLayerMask(layer, displayedLayerFrame(layer, index), index), 1, worldLayerMatrix(layer, index), layer);
        return bakedContext.getImageData(0, 0, frameWidth, frameHeight);
      });
      layer.opacity = 1;
      layer.blendMode = 'source-over';
      layer.motion = Array.from({ length: frameCount }, identityPose);
      layer.keyframes = layer.frames.map(hasPixels);
      layer.type = 'pixel';
      layer.parentId = null;
      layer.hierarchyEnabled = false;
      layer.pivotX = frameWidth / 2;
      layer.pivotY = frameHeight / 2;
      layer.maskEnabled = false;
      layer.maskFrames = null;
      loadDraft();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    }
    hideActionMenu();
  });
  doc.querySelector('#menu-merge-down').addEventListener('click', () => {
    const upper = selectedLayer();
    const upperIndex = layers.findIndex(layer => layer.id === upper?.id);
    const lower = layers[upperIndex - 1];
    if (!upper || !lower || upper.locked || lower.locked || lower.id === 'background') {
      doc.querySelector('#animation-status').textContent = 'Impossible de fusionner : le calque inférieur est verrouillé ou absent.';
      hideActionMenu();
      return;
    }
    saveActiveFrame();
    preserveHierarchyBeforeRemoval([upper, lower]);
    const mergedFrames = Array.from({ length: frameCount }, (_, index) => {
      const output = doc.createElement('canvas');
      output.width = frameWidth;
      output.height = frameHeight;
      const outputContext = output.getContext('2d');
      putLayer(outputContext, applyLayerMask(lower, displayedLayerFrame(lower, index), index), 1, worldLayerMatrix(lower, index), lower);
      putLayer(outputContext, applyLayerMask(upper, displayedLayerFrame(upper, index), index), 1, worldLayerMatrix(upper, index), upper);
      return outputContext.getImageData(0, 0, frameWidth, frameHeight);
    });
    lower.frames = mergedFrames;
    lower.keyframes = mergedFrames.map(hasPixels);
    lower.motion = Array.from({ length: frameCount }, identityPose);
    lower.opacity = 1;
    lower.blendMode = 'source-over';
    lower.lockTransparency = false;
    lower.maskEnabled = false;
    lower.maskFrames = null;
    lower.parentId = null;
    lower.hierarchyEnabled = false;
    lower.pivotX = frameWidth / 2;
    lower.pivotY = frameHeight / 2;
    layers = layers.filter(layer => layer !== upper);
    activeLayerId = lower.id;
    selectedLayerIds = new Set([lower.id]);
    loadDraft();
    paintFrame(activeFrame);
    refreshTimeline();
    scheduleProjectSave();
    doc.querySelector('#animation-status').textContent = `« ${upper.name} » fusionné vers « ${lower.name} ».`;
    hideActionMenu();
  });
  doc.querySelector('#menu-delete-layer').addEventListener('click', () => {
    const layer = selectedLayer();
    if (layer) {
      selectedLayerIds = new Set([layer.id]);
      removeSelectedLayers();
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
    if (layer.maskFrames) {
      newLayer.maskFrames = Array(frameCount).fill(null);
      newLayer.maskFrames[activeFrame] = layer.maskFrames[activeFrame] ? cloneImageData(layer.maskFrames[activeFrame]) : null;
    }
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
    } else if (contextMenuScope === 'layer') {
      removeSelectedLayers();
    } else if (!activeLayer()?.locked) {
      rememberForUndo();
      draftContext.clearRect(0, 0, frameWidth, frameHeight);
      saveActiveFrame();
      markActiveKeyframe();
      paintFrame(activeFrame);
      refreshTimeline();
      scheduleProjectSave();
    }
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
  updateMagneticButton();
  refreshTimeline();
  loadDraft();
  paintFrame(0);
})(globalThis);
