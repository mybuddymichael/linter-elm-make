'use babel';

import {Range} from 'atom';
import path from 'path';
import fs from 'fs-extra';

export default {

  devLog(msg, color) {
    if (atom.config.get('linter-elm-make.logDebugMessages')) {
      if (color) {
        console.log('[linter-elm-make] %c' + msg, 'color:' + color + ';');
      } else {
        console.log('[linter-elm-make] ' + msg);
      }
    }
  },

  isElmEditor(editor) {
    return editor && editor.getPath && editor.getPath() && path.extname(editor.getPath()) === '.elm';
  },

  lookupElmPackage(directory) {
    if (this.fileExists(path.join(directory, 'elm-package.json'))) {
      return directory;
    } else {
      const parentDirectory = path.join(directory, "..");
      if (parentDirectory === directory) {
        atom.notifications.addError('No `elm-package.json` beneath or above the edited file', {
          detail: 'You can generate an `elm-package.json` file by running `elm-package install` from the command line.',
          dismissable: true
        });
        return null;
      } else {
        return this.lookupElmPackage(parentDirectory);
      }
    }
  },

  toggleConfig(key) {
    const oldValue = atom.config.get(key);
    const newValue = !oldValue;
    atom.config.set(key, newValue);
    return newValue;
  },

  fileExists(filePath) {
    try {
      if (fs.statSync(filePath)) {
        return true;
      }
    } catch (e) {
    }
    return false;
  },

  regionToRange(region) {
    if (!region) {
      return null;
    }
    return new Range(
      [region.start.line - 1, region.start.column - 1],
      [region.end.line - 1, region.end.column - 1]
    );
  },

  getLinterPanel() {
    let linterPanel = document.getElementsByTagName('linter-panel');
    if (linterPanel && linterPanel.length > 0) {
      return linterPanel[0];
    }
    return null;
  },

  getLinterTooltip() {
    return document.getElementById('linter-inline');
  },

  tabSpaces() {
    return '    ';
  },

  parseModuleName(text) {
    const regex = /(?:^|\n)((effect|port)\s+)?module\s+([\w\.]+)(?:\s+exposing\s*\(((?:\s*(?:\w+|\(.+\))\s*,)*)\s*((?:\.\.|\w+|\(.+\)))\s*\))?/m;
    const match = regex.exec(text);
    if (match && match.length > 3 && match[3]) {
      return match[3];
    }
    return null;
  },

};
