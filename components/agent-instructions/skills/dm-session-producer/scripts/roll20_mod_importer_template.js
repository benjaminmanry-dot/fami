// DM Session Producer - Roll20 Importer
// Paste this script into Roll20 Mods/API for the target game.
// It cannot upload local files. Upload or drag assets into Roll20 first, bind them, then run !dm-import build.

var DMSessionImporter = DMSessionImporter || (function () {
  'use strict';

  var MANIFEST = __DM_IMPORT_MANIFEST_JSON__;
  var STATE_KEY = 'DMSessionImporter';
  var PX = 70;

  function whisper(message) {
    sendChat('DM Importer', '/w gm ' + message);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function store() {
    state[STATE_KEY] = state[STATE_KEY] || {};
    state[STATE_KEY][MANIFEST.id] = state[STATE_KEY][MANIFEST.id] || {
      assetSources: {},
      builtPages: {},
      builtCharacters: {},
      builtHandouts: {}
    };
    return state[STATE_KEY][MANIFEST.id];
  }

  function allAssets() {
    var result = [];
    ['maps', 'tokens', 'handouts'].forEach(function (group) {
      (MANIFEST.assets[group] || []).forEach(function (asset) {
        var copy = {};
        Object.keys(asset).forEach(function (key) { copy[key] = asset[key]; });
        copy.group = group;
        result.push(copy);
      });
    });
    return result;
  }

  function assetsForGroup(group) {
    if (group === 'all') {
      return allAssets();
    }
    return (MANIFEST.assets[group] || []).map(function (asset) {
      var copy = {};
      Object.keys(asset).forEach(function (key) { copy[key] = asset[key]; });
      copy.group = group;
      return copy;
    });
  }

  function normalizeImgsrc(src) {
    if (!src) return '';
    return src.replace(/\/(max|med|original|thumb)(\.[a-zA-Z]+)(\?[^?]*)?$/, '/thumb$2$3');
  }

  function selectedGraphics(msg) {
    if (!msg.selected || !msg.selected.length) return [];
    return msg.selected
      .map(function (sel) { return getObj('graphic', sel._id); })
      .filter(function (obj) { return !!obj; })
      .sort(function (a, b) {
        var dy = (a.get('top') || 0) - (b.get('top') || 0);
        if (Math.abs(dy) > 10) return dy;
        return (a.get('left') || 0) - (b.get('left') || 0);
      });
  }

  function assetNameMatches(asset, graphic) {
    var name = String(graphic.get('name') || '').toLowerCase();
    var filename = String(asset.filename || asset.key || '').toLowerCase();
    var stem = filename.replace(/\.[^.]+$/, '');
    return name === filename || name === stem || name.indexOf(filename) !== -1 || name.indexOf(stem) !== -1;
  }

  function findPageByName(name) {
    var pages = findObjs({ _type: 'page', name: name });
    return pages && pages.length ? pages[0] : null;
  }

  function ensurePage(pageSpec) {
    var existing = findPageByName(pageSpec.name);
    if (existing) return existing;
    return createObj('page', {
      name: pageSpec.name,
      width: pageSpec.width || 24,
      height: pageSpec.height || 16,
      scale_number: pageSpec.scaleNumber || 5,
      scale_units: pageSpec.scaleUnits || 'ft',
      showgrid: pageSpec.grid === false ? false : true,
      grid_type: 'square',
      snapping_increment: 1
    });
  }

  function removeExistingNamedGraphic(pageId, name) {
    findObjs({ _type: 'graphic', _pageid: pageId, name: name }).forEach(function (obj) {
      obj.remove();
    });
  }

  function createMapGraphic(pageObj, pageSpec, src) {
    var pageWidth = (pageSpec.width || 24) * PX;
    var pageHeight = (pageSpec.height || 16) * PX;
    removeExistingNamedGraphic(pageObj.id, pageSpec.mapAsset);
    createObj('graphic', {
      _pageid: pageObj.id,
      imgsrc: src,
      layer: 'map',
      name: pageSpec.mapAsset,
      left: pageWidth / 2,
      top: pageHeight / 2,
      width: pageWidth,
      height: pageHeight,
      isdrawing: true
    });
  }

  function ensureCharacter(charSpec, src) {
    var existing = findObjs({ _type: 'character', name: charSpec.name })[0];
    if (!existing) {
      existing = createObj('character', {
        name: charSpec.name,
        avatar: src || '',
        gmnotes: charSpec.gmnotes || ''
      });
    } else {
      if (src) existing.set('avatar', src);
      if (charSpec.gmnotes) existing.set('gmnotes', charSpec.gmnotes);
    }
    return existing;
  }

  function createToken(pageObj, tokenSpec, charObj, src) {
    var size = tokenSpec.size || 1;
    var bars = tokenSpec.bars || {};
    createObj('graphic', {
      _pageid: pageObj.id,
      imgsrc: src,
      layer: tokenSpec.layer || 'objects',
      name: tokenSpec.name,
      represents: charObj ? charObj.id : '',
      left: (tokenSpec.x || 1) * PX,
      top: (tokenSpec.y || 1) * PX,
      width: size * PX,
      height: size * PX,
      showname: tokenSpec.showName === false ? false : true,
      bar1_value: bars.hp || '',
      bar1_max: bars.hp || '',
      bar2_value: bars.ac || '',
      bar2_max: '',
      bar3_value: bars.note || '',
      bar3_max: ''
    });
  }

  function ensureHandout(handoutSpec, src) {
    var existing = findObjs({ _type: 'handout', name: handoutSpec.name })[0];
    if (!existing) {
      existing = createObj('handout', {
        name: handoutSpec.name,
        notes: handoutSpec.notes || '',
        gmnotes: handoutSpec.gmnotes || '',
        inplayerjournals: handoutSpec.revealed ? 'all' : '',
        avatar: src || ''
      });
    } else {
      existing.set('notes', handoutSpec.notes || '');
      existing.set('gmnotes', handoutSpec.gmnotes || '');
      if (src) existing.set('avatar', src);
    }
    return existing;
  }

  function commandHelp() {
    whisper(
      '<b>' + esc(MANIFEST.title) + '</b><br>' +
      '1. Upload or drag maps/tokens onto a staging page.<br>' +
      '2. Select maps in manifest order and run <code>!dm-import bind-selection maps</code>.<br>' +
      '3. Select tokens in manifest order and run <code>!dm-import bind-selection tokens</code>.<br>' +
      '4. Run <code>!dm-import status</code>.<br>' +
      '5. Run <code>!dm-import build</code>.<br><br>' +
      'Other commands: <code>!dm-import scan</code>, <code>!dm-import bind &lt;asset-key&gt;</code>, <code>!dm-import reset</code>.'
    );
  }

  function commandStatus() {
    var data = store();
    var rows = allAssets().map(function (asset) {
      var bound = data.assetSources[asset.key] ? 'bound' : (asset.required ? 'missing required' : 'missing optional');
      return esc(asset.key) + ': <b>' + bound + '</b>';
    });
    whisper('<b>Import status for ' + esc(MANIFEST.title) + '</b><br>' + rows.join('<br>'));
  }

  function commandScan() {
    var data = store();
    var pageId = Campaign().get('playerpageid');
    var graphics = findObjs({ _type: 'graphic', _pageid: pageId }) || [];
    var count = 0;
    allAssets().forEach(function (asset) {
      if (data.assetSources[asset.key]) return;
      var match = graphics.filter(function (graphic) {
        return assetNameMatches(asset, graphic);
      })[0];
      if (match) {
        data.assetSources[asset.key] = normalizeImgsrc(match.get('imgsrc'));
        count += 1;
      }
    });
    whisper('Scan complete. Bound ' + count + ' asset(s) by graphic name.');
  }

  function commandBind(msg, key) {
    var data = store();
    var graphics = selectedGraphics(msg);
    if (!graphics.length) {
      whisper('Select one uploaded Roll20 graphic, then run <code>!dm-import bind ' + esc(key || 'asset-key') + '</code>.');
      return;
    }
    var asset = allAssets().filter(function (item) { return item.key === key; })[0];
    if (!asset) {
      whisper('Unknown asset key: <code>' + esc(key) + '</code>. Run <code>!dm-import status</code> to see keys.');
      return;
    }
    data.assetSources[asset.key] = normalizeImgsrc(graphics[0].get('imgsrc'));
    whisper('Bound selected graphic to <code>' + esc(asset.key) + '</code>.');
  }

  function commandBindSelection(msg, group) {
    var data = store();
    group = group || 'all';
    var graphics = selectedGraphics(msg);
    if (!graphics.length) {
      whisper('Select uploaded graphics on the staging page, arranged in the manifest order, then run this command again.');
      return;
    }
    var assets = assetsForGroup(group).filter(function (asset) {
      return !data.assetSources[asset.key];
    });
    var count = Math.min(graphics.length, assets.length);
    for (var i = 0; i < count; i += 1) {
      data.assetSources[assets[i].key] = normalizeImgsrc(graphics[i].get('imgsrc'));
    }
    whisper('Bound ' + count + ' selected graphic(s) to ' + esc(group) + ' assets.');
  }

  function missingRequiredAssets() {
    var data = store();
    return allAssets().filter(function (asset) {
      return asset.required && !data.assetSources[asset.key];
    });
  }

  function commandBuild(allowMissing) {
    var data = store();
    var missing = missingRequiredAssets();
    if (missing.length && !allowMissing) {
      whisper('Missing required assets:<br>' + missing.map(function (asset) {
        return '<code>' + esc(asset.key) + '</code>';
      }).join('<br>') + '<br>Run <code>!dm-import build --allow-missing</code> to build anyway.');
      return;
    }

    var pagesByKey = {};
    (MANIFEST.pages || []).forEach(function (pageSpec) {
      var pageObj = ensurePage(pageSpec);
      pagesByKey[pageSpec.key] = pageObj;
      if (pageSpec.mapAsset && data.assetSources[pageSpec.mapAsset]) {
        createMapGraphic(pageObj, pageSpec, data.assetSources[pageSpec.mapAsset]);
      }
    });

    var charactersByKey = {};
    (MANIFEST.characters || []).forEach(function (charSpec) {
      var src = data.assetSources[charSpec.tokenAsset] || '';
      charactersByKey[charSpec.key] = ensureCharacter(charSpec, src);
    });

    (MANIFEST.pages || []).forEach(function (pageSpec) {
      var pageObj = pagesByKey[pageSpec.key];
      (pageSpec.tokens || []).forEach(function (placement) {
        var charSpec = (MANIFEST.characters || []).filter(function (candidate) {
          return candidate.key === placement.character;
        })[0];
        if (!charSpec) return;
        var src = data.assetSources[charSpec.tokenAsset];
        if (!src) return;
        createToken(pageObj, placement, charactersByKey[charSpec.key], src);
      });
    });

    (MANIFEST.handouts || []).forEach(function (handoutSpec) {
      ensureHandout(handoutSpec, data.assetSources[handoutSpec.asset] || '');
    });

    whisper('Build complete for <b>' + esc(MANIFEST.title) + '</b>. Review pages, token placement, and handouts before play.');
  }

  function commandReset() {
    state[STATE_KEY] = state[STATE_KEY] || {};
    delete state[STATE_KEY][MANIFEST.id];
    whisper('Cleared saved bindings for this manifest.');
  }

  function handleChat(msg) {
    if (msg.type !== 'api' || msg.content.indexOf('!dm-import') !== 0) return;
    var parts = msg.content.split(/\s+/);
    var command = parts[1] || 'help';
    if (command === 'help') commandHelp();
    else if (command === 'status') commandStatus();
    else if (command === 'scan') commandScan();
    else if (command === 'bind') commandBind(msg, parts[2]);
    else if (command === 'bind-selection') commandBindSelection(msg, parts[2] || 'all');
    else if (command === 'build') commandBuild(parts.indexOf('--allow-missing') !== -1);
    else if (command === 'reset') commandReset();
    else commandHelp();
  }

  on('ready', function () {
    store();
    whisper('DM Session Importer ready: <b>' + esc(MANIFEST.title) + '</b>. Run <code>!dm-import help</code>.');
  });

  on('chat:message', handleChat);

  return {};
}());
