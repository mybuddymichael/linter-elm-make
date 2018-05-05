'use babel';

import { Range } from 'atom';
import childProcess from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import _ from 'underscore-plus';

export default {
  debugLog(msg, color) {
    if (atom.config.get('linter-elm-make.logDebugMessages')) {
      if (color) {
        console.log('[linter-elm-make] %c' + msg, 'color:' + color + ';');
      } else {
        console.log('[linter-elm-make] ' + msg);
      }
    }
  },

  isElmEditor(editor) {
    return (
      editor &&
      editor.getPath &&
      editor.getPath() &&
      path.extname(editor.getPath()) === '.elm' &&
      !editor.isRemote // `isRemote` is set to `true` by Atom Teletype.  We'll ignore remote editors for now.
    );
    // TODO: Do not check for `editor.isRemote` anymore once Atom Teletype shares the entire project directory.
  },

  lookupElmPackage(directory, editorFilePath) {
    if (this.fileExists(path.join(directory, 'elm-package.json'))) {
      return directory;
    } else {
      const parentDirectory = path.join(directory, '..');
      if (parentDirectory === directory) {
        const notification = atom.notifications.addError(
          'No `elm-package.json` beneath or above the edited file',
          {
            detail:
              'You can generate an `elm-package.json` file by running `elm package install` from the command line.',
            dismissable: true,
            buttons: [
              {
                text: 'Run `elm package install`',
                onDidClick: () => {
                  this.runElmPackageInstall(path.dirname(editorFilePath));
                  notification.dismiss();
                },
              },
            ],
          }
        );
        return null;
      } else {
        return this.lookupElmPackage(parentDirectory, editorFilePath);
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
    } catch (e) {}
    return false;
  },

  regionToRange(region) {
    if (!region) {
      return null;
    }
    const range = new Range(
      [region.start.line - 1, region.start.column - 1],
      [region.end.line - 1, region.end.column - 1]
    );
    if (range.isEmpty()) {
      return range.translate([0, 0], [0, 1]);
    }
    return range;
  },

  getLinterPanel() {
    let linterPanel = document.getElementsByTagName('linter-panel');
    if (linterPanel && linterPanel.length > 0) {
      return linterPanel[0];
    }
    return null;
  },

  getLinterTooltip() {
    return (
      document.getElementById('linter-tooltip') ||
      document.getElementById('linter-inline')
    );
  },

  tabSpaces() {
    return '    ';
  },

  parseModuleName(text) {
    const match = this.moduleNameRegex().exec(text);
    if (match && match.length > 3 && match[3]) {
      return match[3];
    }
    return null;
  },

  moduleNameRegex() {
    return /(?:^|\n)((effect|port)\s+)?module\s+([\w\.]+)(?:\s+exposing\s*\(((?:\s*(?:\w+|\(.+\))\s*,)*)\s*((?:\.\.|\w+|\(.+\)))\s*\))?/m;
  },

  // From `elmjutsu`.
  runElmPackageInstall(projectDirectory) {
    const args = ['install', '--yes'];
    atom.notifications.addInfo('Running elm package install...');
    const proc = childProcess.spawn(
      atom.config.get('linter-elm-make.elmPackageExecutablePath'),
      args,
      {
        cwd: projectDirectory,
      }
    );
    let outString = '';
    let errString = '';
    proc.stdout.on('data', data => {
      outString = data.toString();
    });
    proc.stderr.on('data', data => {
      errString += data.toString();
    });
    proc.on('error', err => {
      errString = err.toString();
    });
    proc.on('close', (code, signal) => {
      if (code === 0) {
        atom.notifications.addSuccess(outString.replace(/\n/g, '<br>'), {
          dismissable: true,
        });
      } else {
        atom.notifications.addError(errString.replace(/\n/g, '<br>'), {
          dismissable: true,
        });
      }
    });
  },

  // From elmjutsu:
  blockRegex() {
    return /(^{-\|([\s\S]*?)-}\s*|)(^(?!-|{)([^:=\s]+)\s*(:|)(\s*(?:.|\r|\n)*?(?=\n^\S|$(?![\r\n]))))/gm;
  },

  // From elmjutsu:
  getTipeParts(sig) {
    if (!sig || sig.length === 0) {
      return [];
    }
    let parts = [];
    let i = 0;
    let openParens = { '()': 0, '{}': 0 };
    let acc = '';
    const n = sig.length;
    while (i < n) {
      const ch = sig[i];
      if (
        openParens['()'] === 0 &&
        openParens['{}'] === 0 &&
        ch === '-' &&
        i + 1 < n &&
        sig[i + 1] === '>'
      ) {
        parts.push(acc.trim());
        acc = '';
        i += 2;
      } else {
        switch (ch) {
          case '(':
            openParens['()']++;
            break;
          case ')':
            openParens['()']--;
            break;
          case '{':
            openParens['{}']++;
            break;
          case '}':
            openParens['{}']--;
            break;
        }
        acc += ch;
        i++;
        if (i === n) {
          parts.push(acc.trim());
        }
      }
    }
    return parts;
  },
};

function containsPath(superPath, subPath) {
  return superPath.startsWith(subPath);
}
