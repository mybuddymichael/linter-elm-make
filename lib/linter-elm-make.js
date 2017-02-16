'use babel';

import {Range, CompositeDisposable} from 'atom';
import path from 'path';
import fs from 'fs-extra';
import tmp from 'tmp';
import _ from 'underscore';
import chokidar from 'chokidar';
import readDir from 'readdir';
import Queue from 'better-queue';
const atomLinter = require('atom-linter');
import Config from './config';
import QuickFixView from './quick-fix-view';
import SetMainPathsView from './set-main-paths-view';
import quickFixing from './quick-fixing';
import formatting from './formatting';
import helper from './helper';

export default {
  config: Config,
  activate() {
    if (!atom.packages.isPackageLoaded('language-elm')) {
      atom.notifications.addError("The `language-elm` package was not loaded", {
        detail: 'Please install or enable the `language-elm` package in your Settings view.',
        dismissable: true
      });
    }
    if (!atom.packages.isPackageLoaded('linter') &&
        (!atom.packages.isPackageLoaded('nuclide-diagnostics-store') &&
         !atom.packages.isPackageLoaded('nuclide-diagnostics-ui'))) {
      atom.notifications.addError("The `linter` package was not loaded", {
        detail: 'Please install or enable the `linter` package in your Settings view.',
        dismissable: true
      });
    }
    // If `elm-format` is installed and there are errors/warnings, the red/yellow squigglies will disappear after saving.
    // The workaround here is to monkey patch the success() function of `elm-format` to refresh the lint results.
    const elmFormat = atom.packages.getLoadedPackage('elm-format');
    if (elmFormat) {
      const originalSuccessFunction = elmFormat.mainModule.success;
      elmFormat.mainModule.success = (str) => {
        const returnValue = originalSuccessFunction(str);
        refreshLintResultsOfActiveElmEditor();
        return returnValue;
      };
    }
    this.subscriptions = new CompositeDisposable();
    this.lintQueue = new Queue(({editorFilePath, projectDirectory, editor, resolve}, callback) => {
      let progressIndicator;
      if (this.statusBar) {
        progressIndicator = this.statusBar.addLeftTile({
          item: createProgressIndicator(),
          priority: 1
        });
      }
      self.doLint(editorFilePath, projectDirectory, editor)
        .then((result) => {
          if (progressIndicator) {
            progressIndicator.destroy();
          }
          resolve(result);
          callback(null, editor.id);
        });
    }, {
      concurrent: 1,
      filo: true,
      id: ({editor}, callback) => {
        // Will replace task with the same `editor.id`.
        callback(null, editor.id);
      }
    });
    this.workDirectories = {};
    this.watchers = {};
    this.problems = {};
    this.quickFixes = {};
    this.typeAnnotationMarkers = {};
    this.quickFixView = new QuickFixView();
    this.setMainPathsView = new SetMainPathsView();
    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'linter-elm-make:quick-fix': this.quickFix.bind(this),
      'linter-elm-make:quick-fix-all': this.quickFixAll.bind(this),
      'linter-elm-make:set-main-paths': this.setMainPaths.bind(this),
      'linter-elm-make:clear-project-build-artifacts': this.clearProjectBuildArtifacts.bind(this),
      // 'linter-elm-make:clear-build-artifacts': this.clearBuildArtifacts.bind(this),
      'linter-elm-make:toggle-lint-on-the-fly': this.toggleLintOnTheFly,
      'linter-elm-make:toggle-always-compile-main': this.toggleAlwaysCompileMain,
      'linter-elm-make:toggle-report-warnings': this.toggleReportWarnings
    }));
    const self = this;
    this.quickFixView.onDidConfirm(({editor, range, fix}) => {
      quickFixing.fixProblem(editor, range, fix);
      self.clearElmEditorProblemsAndFixes(editor);
    });
    this.setMainPathsView.onDidConfirm(({projectDirectory, mainPaths}) => {
      const jsonFilePath = path.join(projectDirectory, 'linter-elm-make.json');
      let json;
      if (helper.fileExists(jsonFilePath)) {
        json = fs.readJsonSync(jsonFilePath, {throws: false});
        if (!json) {
          atom.notifications.addError('Error reading `linter-elm-make.json`', {dismissable: true});
          return;
        }
        json.mainPaths = mainPaths;
      } else {
        json = {mainPaths: mainPaths};
      }
      fs.writeJsonSync(jsonFilePath, json);
      atom.notifications.addSuccess('Set main paths to `[' + mainPaths.map((mainPath) => '"' + mainPath + '"').join(', ') + ']` in `linter-elm-make.json`', {});
      if (atom.config.get('linter-elm-make.lintOnTheFly')) {
        forceLintActiveElmEditor();
      }
    });
    this.updateLinterUIDebouncer = null;
    let subscribeToElmEditorEvents = (editor) => {
      self.subscriptions.add(editor.onDidChangeCursorPosition(() => {
        self.updateLinterUI();
      }));
      self.subscriptions.add(editor.onDidStopChanging(() => {
        if (editor.isModified()) {
          // We need to check if editor was modified since saving also triggers `onDidStopChanging`.
          self.clearElmEditorProblemsAndFixes(editor);
          self.updateLinterUI();
        } else {
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            self.clearElmEditorProblemsAndFixes(editor);
            forceLintActiveElmEditor();
          }
        }
      }));
      self.subscriptions.add(editor.onDidDestroy(() => {
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          // If editor was modified before it was destroyed, revert the contents of the associated work file to the actual file's contents.
          if (editor.isModified()) {
            const editorFilePath = editor.getPath();
            if (editorFilePath) {
              const projectDirectory = helper.lookupElmPackage(path.dirname(editorFilePath));
              const workDirectory = self.workDirectories[projectDirectory];
              if (workDirectory) {
                const workFilePath = path.join(workDirectory, editorFilePath.replace(projectDirectory, ''));
                fs.writeFileSync(workFilePath, fs.readFileSync(editorFilePath).toString());
              }
            }
          }
        }
      }));
      // TODO When do we delete a project's entries in `this.problems`?
    };
    this.subscriptions.add(atom.workspace.observeTextEditors((editor) => {
      if (helper.isElmEditor(editor)) {
        subscribeToElmEditorEvents(editor);
      }
      self.subscriptions.add(editor.onDidChangePath((path) => {
        if (helper.isElmEditor(editor)) {
          subscribeToElmEditorEvents(editor);
        } else {
          self.clearElmEditorProblemsAndFixes(editor);
        }
      }));
    }));
    this.prevElmEditor = null;
    this.subscriptions.add(atom.workspace.observeActivePaneItem((item) => {
      if (item && helper.isElmEditor(item)) {
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          if (self.prevElmEditor) {
            // When an editor loses focus, update the associated work file.
            const prevTextEditorPath = self.prevElmEditor.getPath();
            if (prevTextEditorPath) {
              const projectDirectory = helper.lookupElmPackage(path.dirname(prevTextEditorPath));
              if (projectDirectory) {
                const workDirectory = self.workDirectories[projectDirectory];
                if (workDirectory) {
                  const workFilePath = path.join(workDirectory, prevTextEditorPath.replace(projectDirectory, ''));
                  if (helper.fileExists(workFilePath)) {
                    // Ignore if work file does not exist, yet.
                    fs.writeFileSync(workFilePath, self.prevElmEditor.getText());
                  }
                }
              }
            }
          }
          forceLintActiveElmEditor();
          self.prevElmEditor = item;
        } else {
          self.prevElmEditor = null;
        }
        self.updateLinterUI();
      } else {
        self.hideQuickFixesIndicators();
        self.prevElmEditor = null;
      }
    }));
  },
  deactivate() {
    if (this.updateLinterUIDebouncer) {
      clearTimeout(this.updateLinterUIDebouncer);
      this.updateLinterUIDebouncer = null;
    }
    this.subscriptions.dispose();
    this.subscriptions = null;
    this.lintQueue.destroy();
    this.lintQueue = null;
    this.workDirectories = null;
    this.watchers = null;
    this.problems = null;
    this.quickFixes = null;
    this.quickFixView.destroy();
    this.quickFixView = null;
    this.setMainPathsView.destroy();
    this.setMainPathsView = null;
    this.prevElmEditor = null;
    if (this.quickFixesIndicator) {
      this.quickFixesIndicator.destroy();
      this.quickFixesIndicator = null;
    }
    this.hideQuickFixesIndicators();
    destroyAllMarkers(this.typeAnnotationMarkers);
    this.typeAnnotationMarkers = null;
  },
  hideQuickFixesIndicators() {
    if (this.quickFixesTooltip) {
      this.quickFixesTooltip.dispose();
      this.quickFixesTooltip = null;
    }
    if (this.quickFixesIndicator) {
      this.quickFixesIndicator.item.innerHTML = '';
    }
  },
  clearElmEditorProblemsAndFixes(editor) {
    const editorFilePath = editor.getPath();
    if (this.problems[editorFilePath]) { delete this.problems[editorFilePath]; }
    if (this.quickFixes[editorFilePath]) { delete this.quickFixes[editorFilePath]; }
    destroyEditorMarkers(this.typeAnnotationMarkers, editor.id);
    this.typeAnnotationMarkers[editor.id] = [];
  },
  quickFix() {
    const fixesForCursorPosition = this.getFixesAtCursorPosition();
    if (fixesForCursorPosition) {
      this.quickFixView.show(atom.workspace.getActiveTextEditor(), fixesForCursorPosition.range, fixesForCursorPosition.fixes);
    } else {
      showNoQuickFixesFound();
    }
  },
  quickFixAll() {
    const editor = atom.workspace.getActiveTextEditor();
    let markers = [];
    let marker = null;
    const quickFixes = this.allQuickFixes(editor);
    if (quickFixes) {
      editor.transact(() => {
        quickFixes.forEach(({range, fixes}) => {
          marker = editor.markBufferRange(range, {invalidate: 'never', persistent: false});
          marker.setProperties({fixes: fixes});
          markers.push(marker);
        });
        markers.forEach((marker) => {
          quickFixing.fixProblem(editor, marker.getBufferRange(), marker.getProperties().fixes[0]);
          marker.destroy();
        });
        markers = null;
      });
      this.clearElmEditorProblemsAndFixes(editor);
    }
  },
  allQuickFixes(editor) {
    return this.quickFixes[editor.getPath()] || this.computeQuickFixesForEditor(editor);
  },
  toggleLintOnTheFly() {
    const lintOnTheFly = helper.toggleConfig('linter-elm-make.lintOnTheFly');
    atom.notifications.addInfo('"Lint On The Fly" is now ' + (lintOnTheFly ? 'ON' : 'OFF'), {});
    if (lintOnTheFly) {
      forceLintActiveElmEditor();
    }
  },
  toggleAlwaysCompileMain() {
    const alwaysCompileMain = helper.toggleConfig('linter-elm-make.alwaysCompileMain');
    atom.notifications.addInfo('"Always Compile Main" is now ' + (alwaysCompileMain ? 'ON' : 'OFF'), {});
    if (atom.config.get('linter-elm-make.lintOnTheFly')) {
      forceLintActiveElmEditor();
    }
  },
  toggleReportWarnings() {
    const reportWarnings = helper.toggleConfig('linter-elm-make.reportWarnings');
    atom.notifications.addInfo('"Report Warnings" is now ' + (reportWarnings ? 'ON' : 'OFF'), {});
    if (atom.config.get('linter-elm-make.lintOnTheFly')) {
      forceLintActiveElmEditor();
    }
  },
  setMainPaths() {
    const editor = atom.workspace.getActiveTextEditor();
    const editorFilePath = editor.getPath();
    if (editorFilePath) {
      const projectDirectory = helper.lookupElmPackage(path.dirname(editorFilePath));
      if (!projectDirectory) {
        return;
      }
      const jsonFilePath = path.join(projectDirectory, 'linter-elm-make.json');
      let json;
      if (helper.fileExists(jsonFilePath)) {
        json = fs.readJsonSync(jsonFilePath, {throws: false});
      }
      const mainPaths = (json && json.mainPaths) || [];
      this.setMainPathsView.show(editorFilePath.replace(projectDirectory + path.sep, ''), projectDirectory, mainPaths);
    }
  },
  // Deletes the .elmi and .elmo files in your project's build artifacts directory (e.g. elm-stuff/build-artifacts/0.17.0/user/project/1.0.0).
  clearProjectBuildArtifacts() {
    const editor = atom.workspace.getActiveTextEditor();
    const editorFilePath = editor.getPath();
    let deleteBuildArtifacts = (directory) => {
      if (!helper.fileExists(directory)) {
        return false;
      }
      const files = fs.readdirSync(directory);
      files.forEach((filename) => {
        const ext = path.extname(filename);
        if (ext === '.elmi' || ext === '.elmo') {
          fs.unlinkSync(path.join(directory, filename));
        }
      });
      return true;
    };
    const self = this;
    getProjectBuildArtifactsDirectory(editorFilePath)
      .then(buildArtifactsDirectory => {
        if (buildArtifactsDirectory) {
          const projectDirectory = helper.lookupElmPackage(path.dirname(editorFilePath));
          const buildArtifactsDirectoryCleared = deleteBuildArtifacts(buildArtifactsDirectory);
          if (buildArtifactsDirectoryCleared && atom.config.get('linter-elm-make.logDebugMessages')) {
            helper.devLog('Cleared project directory build artifacts - ' + buildArtifactsDirectory, 'green');
          }
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            // If linting on the fly, also delete the build artifacts in the work directory.
            if (projectDirectory) {
              const workDirectory = self.workDirectories[projectDirectory];
              if (workDirectory) {
                const workDirectoryBuildArtifactsDirectory = buildArtifactsDirectory.replace(projectDirectory, workDirectory);
                const workDirectoryBuildArtifactsDirectoryCleared = deleteBuildArtifacts(workDirectoryBuildArtifactsDirectory);
                if (workDirectoryBuildArtifactsDirectoryCleared && atom.config.get('linter-elm-make.logDebugMessages')) {
                  helper.devLog('Cleared work directory build artifacts - ' + workDirectoryBuildArtifactsDirectory, 'green');
                }
              }
            }
          }
          atom.notifications.addSuccess('Cleared `' + buildArtifactsDirectory.replace(projectDirectory + path.sep, '') + '`', {});
        }
      });
  },
  provideIntentions: function() {
    const self = this;
    return {
      grammarScopes: ['source.elm'],
      getIntentions: function({textEditor, bufferPosition}) {
        const fixesForCursorPosition = self.getFixesAtCursorPosition();
        if (fixesForCursorPosition) {
          return fixesForCursorPosition.fixes.map((fix) => {
            return {
              // Since `Intentions` does not allow specifying HTML, do a workaround here:
              class: 'linter-elm-make-fix--' + fix.type.toLowerCase().replace(/ /g, '-'),
              title: fix.text,
              selected: function() {
                quickFixing.fixProblem(textEditor, fixesForCursorPosition.range, fix);
                self.clearElmEditorProblemsAndFixes(textEditor);
              }
            };
          });
        } else {
          showNoQuickFixesFound();
          return [];
        }
      }
    };
  },
  provideLinter() {
    const proc = process;
    const self = this;
    const linter = {
      // name: 'Elm',
      grammarScopes: ['source.elm'],
      scope: 'project',
      lintOnFly: true,
      lint(editor) {
        const editorFilePath = editor.getPath();
        if (!editorFilePath) {
          return [];
        }
        const projectDirectory = helper.lookupElmPackage(path.dirname(editorFilePath));
        if (projectDirectory === null) {
          return [];
        }
        return new Promise((resolve) => {
          self.lintQueue.push({
            editorFilePath,
            projectDirectory,
            editor,
            resolve
          });
        });
      }
    };
    const removeWatchersAndWorkDirectories = () => {
      for (let projectDirectory in self.watchers) {
        if (self.watchers.hasOwnProperty(projectDirectory)) {
          self.watchers[projectDirectory].close();
        }
      }
      self.watchers = {};
      self.workDirectories = {};
      // TODO Also delete temporary directories.
    };
    this.subscriptions.add(atom.config.observe('linter-elm-make.lintOnTheFly', lintOnTheFly => {
      linter.lintOnFly = lintOnTheFly;
      if (!lintOnTheFly) {
        removeWatchersAndWorkDirectories();
      }
    }));
    this.subscriptions.add(atom.config.observe('linter-elm-make.workDirectory', workDirectory => {
      removeWatchersAndWorkDirectories();
    }));
    this.subscriptions.add(atom.config.observe('linter-elm-make.showInferredTypeAnnotations', show => {
      if (!show) {
        destroyAllMarkers(self.typeAnnotationMarkers);
        self.typeAnnotationMarkers = {};
      }
    }));
    this.subscriptions.add(atom.config.observe('linter-elm-make.autoscrollIssueIntoView', autoscroll => {
      if (!autoscroll) {
        const linterPanel = helper.getLinterPanel();
        if (linterPanel) {
          if (self.prevProblemAnchor) {
            self.prevProblemAnchor.parentNode.parentNode.parentNode.className = 'linter-elm-make-issue';
            self.prevProblemAnchor = null;
          }
        }
      }
    }));
    return linter;
  },
  maybeCopyProjectToWorkDirectory(projectDirectory) {
    const self = this;
    return new Promise((resolve) => {
      const configWorkDirectory = atom.config.get('linter-elm-make.workDirectory');
      if (configWorkDirectory && configWorkDirectory.trim() !== '') {
        if (!self.workDirectories[projectDirectory]) {
          const workDirectory = path.resolve(projectDirectory, configWorkDirectory);
          self.workDirectories[projectDirectory] = workDirectory;
          // If work directory does not exist, create it and copy source files from project directory.
          if (!helper.fileExists(workDirectory)) {
            helper.devLog('Created work directory - ' + projectDirectory + ' -> ' + workDirectory, 'green');
            const self = this;
            self.copyProjectToWorkDirectory(projectDirectory, workDirectory)
              .then(() => {
                self.watchProjectDirectory(projectDirectory, workDirectory);
                return resolve();
              });
          } else {
            self.watchProjectDirectory(projectDirectory, workDirectory);
          }
        }
      }
      return resolve();
    });
  },
  doLint(editorFilePath, projectDirectory, editor) {
    const self = this;
    return new Promise((resolve) => {
      if (isASourceDirectoryOutsideProjectDirectory(projectDirectory)) {
        return resolve([]);
      }
      this.maybeCopyProjectToWorkDirectory(projectDirectory)
        .then(() => {
          if (atom.config.get('linter-elm-make.lintOnTheFly')) {
            // Lint on the fly.
            if (!self.workDirectories[projectDirectory]) {
              // Create a temporary directory for the project.
              const workDirectory = tmp.dirSync({prefix: 'linter-elm-make'}).name;
              helper.devLog('Created temporary work directory - ' + workDirectory + ' -> ' + projectDirectory, 'green');
              self.workDirectories[projectDirectory] = workDirectory;
              self.copyProjectToWorkDirectory(projectDirectory, workDirectory)
                .then(() => {
                  self.watchProjectDirectory(projectDirectory, workDirectory);
                  return resolve(self.compileInWorkDirectory(editorFilePath, self.workDirectories[projectDirectory], editor, projectDirectory));
                });
            } else {
              return resolve(self.compileInWorkDirectory(editorFilePath, self.workDirectories[projectDirectory], editor, projectDirectory));
            }
          } else {
            // Lint on save.
            const workDirectory = self.workDirectories[projectDirectory] || projectDirectory;
            if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
              return resolve(self.compileMainFiles(editorFilePath, projectDirectory, workDirectory, editor, (mainFilePath) => mainFilePath));
            } else {
              // Compile active file.
              return resolve(self.executeElmMake(editorFilePath, editorFilePath, workDirectory, editor, projectDirectory));
            }
          }
        });
    });
  },
  copyProjectToWorkDirectory(projectDirectory, workDirectory, options) {
    const self = this;
    return new Promise((resolve) => {
      atom.notifications.addInfo('Copying project files to work directory `' + workDirectory + '`...', {});
      helper.devLog('Syncing work directory with project directory - ' + projectDirectory + ' -> ' + workDirectory);
      // Use `setTimeout` to show the above notification immediately.
      setTimeout(() => {
        if (options && options.deleteSourceDirectoriesInWorkDirectory) {
          self.deleteSourceDirectoriesInWorkDirectory(projectDirectory, workDirectory);
        }
        // Recursively copy source directories, `elm-package.json`, and `elm-stuff` from project directory to work directory.
        // Initial linting might take time depending on the project directory size.
        const copyOptions = {
          preserveTimestamps: true
        };
        // Copy `elm-package.json` to work directory.
        const elmPackageJsonFilePath = path.join(projectDirectory, 'elm-package.json');
        fs.copySync(elmPackageJsonFilePath, path.join(workDirectory, 'elm-package.json'), copyOptions);
        // Copy `elm-stuff` to work directory.
        // Assumes that work directory is not inside `elm-stuff`.
        const elmStuffFilePath = path.join(projectDirectory, 'elm-stuff');
        if (helper.fileExists(elmStuffFilePath)) {
          fs.copySync(elmStuffFilePath, path.join(workDirectory, 'elm-stuff'), copyOptions);
        }
        // Copy source directories to work directory.
        // Be careful with source directories outside of the project directory (e.g. "../../src").
        let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
        if (!json) {
          return resolve();
        }
        // TODO Check if `sourceDirectories` is an array of strings.
        const sourceDirectories = json['source-directories'];
        if (sourceDirectories && sourceDirectories.length > 0) {
          const copyOptionsWithElmFilter = JSON.parse(JSON.stringify(copyOptions));
          copyOptionsWithElmFilter.filter = (filePath) => {
            return path.extname(filePath) === '.elm';
          };
          const copyOptionsWithElmAndDirectoryFilter = JSON.parse(JSON.stringify(copyOptions));
          copyOptionsWithElmAndDirectoryFilter.filter = (filePath) => {
            return !filePath.startsWith(workDirectory + path.sep) && copyOptionsWithElmFilter.filter(filePath);
          };
          // Filter out child source directories (i.e. if a source directory is inside another, do not copy files for that source directory anymore).
          const allSourceDirectories = sourceDirectories.map(x => path.resolve(projectDirectory, x));
          const parentSourceDirectories =
            new Set(
              allSourceDirectories
                .filter(x => !allSourceDirectories.some(y => x != y && x.startsWith(y + path.sep))));

          parentSourceDirectories.forEach((projectSourceDirectory) => {
            const workSourceDirectory = projectSourceDirectory.replace(projectDirectory, workDirectory);
            if (helper.fileExists(projectSourceDirectory)) {
              helper.devLog('> Copying project source directory to work directory - ' + projectSourceDirectory + ' -> ' + workSourceDirectory);
              // If work directory is inside project directory...
              if ((workDirectory + path.sep).startsWith(projectDirectory)) {
                const projectFilePaths = readDir.readSync(projectSourceDirectory, null, readDir.ABSOLUTE_PATHS);
                projectFilePaths.forEach((projectFilePath) => {
                  const workFilePath = projectFilePath.replace(projectDirectory, workDirectory);
                  fs.copySync(projectFilePath, workFilePath, copyOptionsWithElmAndDirectoryFilter);
                });
              } else {
                fs.copySync(projectSourceDirectory, workSourceDirectory, copyOptionsWithElmFilter);
              }
              if (atom.config.get('linter-elm-make.logDebugMessages')) {
                if (helper.fileExists(workSourceDirectory)) {
                  helper.devLog('> Copied project source directory to work directory - ' + projectSourceDirectory + ' -> ' + workSourceDirectory, 'green');
                }
              }
            }
          });
        }
        atom.notifications.addSuccess('Copied project files to work directory `' + workDirectory + '`', {});
        helper.devLog('Synched work directory with project directory - ' + projectDirectory + ' -> ' + workDirectory, 'green');
        return resolve();
      }, 0);
    });
  },
  watchProjectDirectory(projectDirectory, workDirectory) {
    // Watch project directory for file changes.
    let ignored = [];
    if ((workDirectory + path.sep).startsWith(projectDirectory)) {
      ignored.push(workDirectory.replace(projectDirectory + path.sep, '') + path.sep + '**');
    }
    // TODO Only watch source directories.
    let watcher = chokidar.watch(['elm-package.json', 'elm-stuff/exact-dependencies.json', 'elm-stuff/packages/**', '**/*.elm'], {
      cwd: projectDirectory,
      usePolling: true, useFsEvents: true, persistent: true,
      ignored: ignored, ignoreInitial: true,
      followSymlinks: false, interval: 100, alwaysStat: false, depth: undefined,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignorePermissionErrors: false, atomic: false
    });
    this.watchers[projectDirectory] = watcher;
    watcher.on('add', (filename) => {
      const filePath = path.join(projectDirectory, filename);
      if (!filePath.startsWith(workDirectory + path.sep) &&
        (filePath === path.join(projectDirectory, 'elm-package.json') ||
         filePath === path.join(projectDirectory, 'elm-stuff', 'exact-dependencies.json') ||
         filePath.startsWith(path.join(projectDirectory, 'elm-stuff', 'packages')) ||
         path.extname(filePath) === '.elm')) {
         helper.devLog('`add` detected - ' + filePath);
        fs.copySync(filePath, path.join(workDirectory, filename));
      }
    });
    // watcher.on('addDir', (filename) => {
    //   const filePath = path.join(projectDirectory, filename);
    //   if (!filePath.startsWith(workDirectory + path.sep) &&
    //     filePath.startsWith(path.join(projectDirectory, 'elm-stuff', 'packages'))) {
    //     if (atom.config.get('linter-elm-make.logDebugMessages')) {
    //       helper.devLog('`addDir` detected - ' + filePath);
    //     }
    //     fs.mkdirsSync(path.join(workDirectory, filename));
    //   }
    // });
    watcher.on('unlink', (filename) => {
      const filePath = path.join(projectDirectory, filename);
      helper.devLog('`unlink` detected - ' + filePath);
      if (!filePath.startsWith(workDirectory + path.sep)) {
        fs.removeSync(path.join(workDirectory, filename));
        // TODO Only force lint if active editor is inside `projectDirectory`.
        if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          forceLintActiveElmEditor();
        }
      }
    });
    watcher.on('unlinkDir', (dirname) => {
      const dirPath = path.join(projectDirectory, dirname);
      helper.devLog('`unlinkDir` detected - ' + dirPath);
      if (!dirPath.startsWith(workDirectory + path.sep)) {
        fs.removeSync(path.join(workDirectory, dirname));
      }
    });
    watcher.on('change', (filename) => {
      const filePath = path.join(projectDirectory, filename);
      if (!filePath.startsWith(workDirectory + path.sep)) {
        if (filePath === path.join(projectDirectory, 'elm-package.json') ||
            filePath === path.join(projectDirectory, 'elm-stuff', 'exact-dependencies.json')) {
         helper.devLog('`change` detected - ' + filename);

        if (!isASourceDirectoryOutsideProjectDirectory(projectDirectory)) {
          // TODO Only do `copyProjectToWorkDirectory` if the value of "source-directories" was changed.
          this.copyProjectToWorkDirectory(projectDirectory, workDirectory, {deleteSourceDirectoriesInWorkDirectory: true})
            .then(() => {
              const workFilePath = path.join(workDirectory, filePath.replace(projectDirectory, ''));
              fs.writeFileSync(workFilePath, fs.readFileSync(filePath).toString());
              if (filePath === path.join(projectDirectory, 'elm-package.json')) {
                forceLintActiveElmEditor();
              }
            });
        }

        } else if (atom.config.get('linter-elm-make.lintOnTheFly')) {
          const workDirectory = this.workDirectories[projectDirectory];
          if (workDirectory) {
            const workFilePath = path.join(workDirectory, filePath.replace(projectDirectory, ''));
            if (helper.fileExists(workFilePath)) {
              // Ignore if work file does not exist, yet.
              fs.writeFileSync(workFilePath, fs.readFileSync(filePath).toString());
            }
          }
        }
      }
    });
    // TODO Handle when projectDirectory gets renamed or deleted.
    // TODO When to close watcher, delete temporary directory, and delete self.workDirectories[projectDirectory]?
  },
  deleteSourceDirectoriesInWorkDirectory(projectDirectory, workDirectory) {
    let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
    if (json) {
      const sourceDirectories = json['source-directories'];
      // TODO Check if `sourceDirectories` is an array of strings.
      if (sourceDirectories) {
        sourceDirectories.forEach((sourceDirectory) => {
          const workDirectorySourceDirectory = path.resolve(workDirectory, sourceDirectory);
          fs.removeSync(workDirectorySourceDirectory);
          helper.devLog('> Deleted source directory in work directory - ' + workDirectorySourceDirectory, 'green');
        });
      }
    }
  },
  provideGetWorkDirectory() {
    const self = this;
    return (filePath) => {
      const projectDirectory = helper.lookupElmPackage(path.dirname(filePath));
      if (projectDirectory === null) {
        return null;
      }
      return self.workDirectories[projectDirectory] || projectDirectory;
    };
  },
  compileInWorkDirectory(editorFilePath, workDirectory, editor, projectDirectory) {
    const workFilePath = path.join(workDirectory, editorFilePath.replace(projectDirectory, ''));
    // Write contents of active editor to associated compile file.
    if (helper.fileExists(workFilePath)) {
      // Ignore if work file does not exist, yet.
      fs.writeFileSync(workFilePath, editor.getText());
    }
    if (atom.config.get('linter-elm-make.alwaysCompileMain')) {
      return this.compileMainFiles(editorFilePath, projectDirectory, workDirectory, editor, (mainFilePath) => mainFilePath.replace(projectDirectory, workDirectory));
    } else {
      // Compile active file.
      return this.executeElmMake(editorFilePath, workFilePath, workDirectory, editor, projectDirectory);
    }
  },
  compileMainFiles(editorFilePath, projectDirectory, cwd, editor, mainFilePathTransformFunction) {
    const mainFilePaths = this.getMainFilePaths(projectDirectory);
    if (mainFilePaths) {
      // Compile the main files, then combine the linting results.
      const elmMakePromises = mainFilePaths.map((mainFilePath) => {
        return this.executeElmMake(editorFilePath, mainFilePathTransformFunction(mainFilePath), cwd, editor, projectDirectory);
      });
      return Promise.all(elmMakePromises).then((results) => {
        return _.flatten(results, true);
      });
    } else {
      return [];
    }
  },
  getMainFilePaths(projectDirectory) {
    const elmPackageJsonFilePath = path.join(projectDirectory, 'elm-package.json');
    if (!helper.fileExists(elmPackageJsonFilePath)) {
      return null;
    }
    const elmPackageJson = fs.readJsonSync(elmPackageJsonFilePath, {throws: false});
    if (!elmPackageJson) {
      return null;
    }
    const linterElmMakeJsonFilePath = path.join(projectDirectory, 'linter-elm-make.json');
    let linterElmMakeJson;
    if (helper.fileExists(linterElmMakeJsonFilePath)) {
      linterElmMakeJson = fs.readJsonSync(linterElmMakeJsonFilePath, {throws: false});
    }
    const mainPaths = linterElmMakeJson && linterElmMakeJson.mainPaths;
    const errorDetail =
      'Note that "Always Compile Main" is ON.  You can do one of the following:\n' +
      ' - Turn off "Always Compile Main" in the package settings to compile the active file instead.\n' +
      ' - Set the main paths of the project using `Linter Elm Make: Set Main Paths`. (Saves the main paths to `linter-elm-make.json`.)\n' +
      ' - Put a `Main.elm` file in at least one of the source directories.';
    // If `mainPaths` exists, use that.
    if (mainPaths && mainPaths.length > 0) {
      const BreakException = {};
      try {
        return mainPaths.map((mainPath) => {
          const mainFilePath = path.resolve(projectDirectory, mainPath);
          if (!helper.fileExists(mainFilePath)) {
            atom.notifications.addError('The main path `' + mainPath + '` does not exist', {
              detail: errorDetail,
              dismissable: true
            });
            throw BreakException;
          }
          const isMainPathInsideSourceDirectory = (sourceDirectories, filePath) => {
            // TODO Check if `sourceDirectories` is an array of strings.
            if (sourceDirectories) {
              for (let i in sourceDirectories) {
                const sourceDirectory = sourceDirectories[i];
                if (filePath.startsWith(path.resolve(projectDirectory, sourceDirectory) + path.sep)) {
                  return true;
                }
              }
            }
            return false;
          };
          if (!isMainPathInsideSourceDirectory(elmPackageJson['source-directories'], mainFilePath)) {
            atom.notifications.addError('The main path `' + mainPath + '` is not inside a source directory', {
              detail: errorDetail,
              dismissable: true
            });
            throw BreakException;
          }
          return mainFilePath;
        });
      } catch(e) {
        if (e !== BreakException) {
          return null;
        }
      }
    } else {
      // Else, look for `Main.elm` files in the source directories.
      // TODO Check if `sourceDirectories` is an array of strings.
      const sourceDirectories = elmPackageJson['source-directories'];
      if (sourceDirectories) {
        const mainFilePaths =
          sourceDirectories
          .map((sourceDirectory) => {
            return path.join(projectDirectory, sourceDirectory, 'Main.elm');
          })
          .filter((mainFilePath) => {
            // TODO If `Main.elm` does not exist, look for the file containing `main =`?
            return helper.fileExists(mainFilePath);
          });
        if (mainFilePaths.length > 0) {
          return mainFilePaths;
        } else {
          atom.notifications.addError('Could not find `Main.elm` in `[' + sourceDirectories.map((directory) => '"' + directory + '"').join(', ') + ']`', {
            detail: errorDetail,
            dismissable: true
          });
        }
      }
    }
    return null;
  },
  consumeStatusBar(statusBar) {
    if (!statusBar) return;

    this.statusBar = statusBar;
    this.quickFixesIndicator = this.statusBar.addLeftTile({
      item: createQuickFixesIndicator(),
      priority: 1
    });
  },
  executeElmMake(editorFilePath, inputFilePath, cwd, editor, projectDirectory) {
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
    let args = [inputFilePath, '--report=json', '--output=/dev/null', '--yes'];
    if (atom.config.get('linter-elm-make.reportWarnings')) {
      args.push('--warn');
    }
    let self = this;
    helper.devLog('Executing ' + executablePath + ' ' + args.join(' ') + ' (initiated from ' + editorFilePath + ')');
    return atomLinter.exec(executablePath, args, {
      stream: 'both', // stdout and stderr
      cwd: cwd,
      env: process.env
    })
    .then(data => {
      self.clearElmEditorProblemsAndFixes(editor);
      // Filter Haskell memory error messages (see https://ghc.haskell.org/trac/ghc/ticket/12495).
      data.stderr = data.stderr.split('\n').filter((line) => line !== 'elm-make: unable to decommit memory: Invalid argument').join('\n');
      const result = data.stderr === '' ?
        self.parseStdout(data.stdout, editorFilePath, cwd, editor, projectDirectory) :
        self.parseStderr(data.stderr, editorFilePath);
      // Only compute quick fixes for the active editor.
      // Quick fixes for the other editors will be computed on demand (upon calling `quick-fix` or `quick-fix-all`).
      self.computeQuickFixesForEditor(editor);
      self.maybeShowInferredTypeAnnotations(editor);
      self.updateLinterUI();
      return result;
    })
    .catch(errorMessage => {
      atom.notifications.addError('Failed to run ' + executablePath, {
        detail: errorMessage,
        dismissable: true
      });
      self.updateLinterUI();
      return [];
    });
  },
  parseStdout(stdout, editorFilePath, cwd, editor, projectDirectory) {
    const problemsByLine = stdout.split('\n').map((line) => {
      let json = (() => {
        try {
          return JSON.parse(line);
        } catch (error) {
          // elm-make outputs other lines besides the report
        }
      })();
      if (!json) {
        return [];
      }
      if (!atom.config.get('linter-elm-make.reportWarnings')) {
        json = json.filter(problem => { return problem.type !== 'warning'; });
      }
      return json.map((problem) => {
        const regionRange = helper.regionToRange(problem.region);
        const subregionRange = helper.regionToRange(problem.subregion);
        let filePath = problem.file;
        if (problem.file.startsWith('.' + path.sep)) {
          // `problem.file` has a relative path (e.g. `././A.elm`) . Convert to absolute.
          filePath = path.join(cwd, path.normalize(problem.file));
        }
        if (cwd !== projectDirectory) {
          // problem.file is a work file
          filePath = filePath.replace(cwd, projectDirectory);
        }
        return {
          type: problem.type,
          // HACK: Add an anchor so that we can scroll the relevant message into view when the cursor position changes.
          html:
            '<div style="visibility:collapsed" class="' + getAnchorForMessage(filePath, regionRange, subregionRange) + '"></div>' +
            '<div class="linter-elm-make-problem-overview">' + _.escape(problem.overview) + '</div><br>' +
            formatting.formatProblemDetails(problem) +
            '<br>', // There's an extra line break here so that the line and column info from linter will be at the next line.
          filePath,
          range: subregionRange || regionRange,
          regionRange,
          subregionRange,
          problem
        };
      });
    });
    const problemsWithoutWorkFiles = problemsByLine.map((problems) => {
      return problems.filter((problem) => {
        // Filter out work files.
        return problem.filePath.startsWith(projectDirectory);
      });
    });
    const allProblems = _.flatten(problemsWithoutWorkFiles, true);
    // Store problems for each file path.
    const uniqueFilePaths = new Set(allProblems.map(({filePath}) => filePath));
    const getProblemsOfFilePath = (fpath) => {
      return allProblems.filter(({filePath}) => {
        return filePath === fpath;
      });
    };
    for (let filePath of uniqueFilePaths) {
      this.problems[filePath] = getProblemsOfFilePath(filePath);
    }
    return allProblems;
  },
  parseStderr(stderr, editorFilePath) {
    const stderrLines = stderr.split('\n');
    let lineNumber = 0;
    const lineNumberRegexp = /^(\d+)\|.*/g;
    stderrLines.forEach((line) => {
      const matches = lineNumberRegexp.exec(line);
      if (matches !== null) {
        matches.forEach((match) => {
          lineNumber = parseInt(match) - 1;
        });
      }
    });
    const range = new Range([lineNumber, 0], [lineNumber, 0]);
    const problem = {
      type: 'error',
      html:
        formatting.formatProblemDetails(stderr) +
        '<br>', // There's an extra line break here so that the line and column info from linter will be at the next line.
      filePath: editorFilePath,
      regionRange: range,
      range: range,
      problem: stderr
    };
    this.problems[editorFilePath] = [problem];
    return [problem];
  },
  computeQuickFixesForEditor(editor) {
    const editorFilePath = editor.getPath();
    const problems = this.problems[editorFilePath];
    if (problems) {
      const quickFixes =
        problems.map(({problem, range}) => {
          return {
            fixes: quickFixing.getFixesForProblem(problem, editor.getTextInBufferRange(range), editor),
            range: range
          };
        })
        .filter(({fixes}) => {
          return fixes !== null;
        });
      this.quickFixes[editorFilePath] = quickFixes;
      return quickFixes;
    } else {
      this.quickFixes[editorFilePath] = [];
      return null;
    }
  },
  getFixesAtCursorPosition() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!helper.isElmEditor(editor)) {
      return null;
    }
    const position = editor.getLastCursor().getBufferPosition();
    // Look for fixes for the issue at cursor position.
    let fixesForPosition = null;
    const quickFixes = this.allQuickFixes(editor);
    if (quickFixes) {
      _.find(quickFixes, ({range, fixes}) => {
        if (range.containsPoint(position)) {
          fixesForPosition = {range, fixes};
          return true;
        }
        return false;
      });
    }
    return fixesForPosition;
  },
  updateLinterUI() {
    this.hideQuickFixesIndicators();
    if (this.updateLinterUIDebouncer) {
      clearTimeout(this.updateLinterUIDebouncer);
      this.updateLinterUIDebouncer = null;
    }
    this.updateLinterUIDebouncer =
      setTimeout(() => {
        this.updateQuickFixesIndicators();
        this.maybeScrollProblemAtCursorIntoView();
    }, 300);
  },
  updateQuickFixesIndicators() {
    const fixesForCursorPosition = this.getFixesAtCursorPosition();
    const numFixes = fixesForCursorPosition ? fixesForCursorPosition.fixes.length : 0;
    // Update quick fixes indicator in status bar.
    if (this.quickFixesIndicator) {
      const fixesForCursorPosition = this.getFixesAtCursorPosition();
      this.quickFixesIndicator.item.innerHTML = numFixes > 0 ? '<span class="linter-elm-make-quick-fixes-status">Quick Fixes: ' + numFixes + '</span>': '';
    }
    // Update quick fixes tooltip.
    const linterTooltip = helper.getLinterTooltip();
    if (linterTooltip) {
      if (numFixes > 0) {
        this.quickFixesTooltip = atom.tooltips.add(linterTooltip, {
          title: ' ' + parseInt(numFixes, 10),
          trigger: 'manual',
          placement: 'auto left',
          class: 'linter-elm-make-quick-fixes-tooltip',
          delay: {show: 0, hide: 0}
        });
      }
    }
  },
  maybeShowInferredTypeAnnotations(editor) {
    destroyEditorMarkers(this.typeAnnotationMarkers, editor.id);
    this.typeAnnotationMarkers[editor.id] = [];
    if (atom.config.get('linter-elm-make.showInferredTypeAnnotations')) {
      this.quickFixesWhere(editor, fix => fix.type === 'Add type annotation')
        .forEach(({range, fixes}) => {
          let element = document.createElement('div');
          element.classList.add('linter-elm-make-inferred-type-annotation');
          element.textContent = fixes[0].text;
          let marker = editor.markBufferPosition(range.start);
          marker.setProperties({fixType: 'Add type annotation', fixRange: range});
          editor.decorateMarker(marker, {type: 'block', position: 'before', item: element});
          this.subscriptions.add(marker.onDidDestroy(() => {
            let markerIndex = this.typeAnnotationMarkers[editor.id].indexOf(marker);
            if(markerIndex != -1) {
              this.typeAnnotationMarkers[editor.id].splice(markerIndex, 1);
            }
          }));
          this.typeAnnotationMarkers[editor.id].push(marker);
        });
    }
  },
  quickFixesWhere(editor, fixPredicate) {
    return (this.allQuickFixes(editor) || [])
      .map(quickFix => Object.assign({}, quickFix, { fixes: quickFix.fixes.filter(fixPredicate) }))
      .filter(quickFix => quickFix.fixes.length > 0);
  },
  maybeScrollProblemAtCursorIntoView() {
    if (atom.config.get('linter-elm-make.autoscrollIssueIntoView')) {
      const linterPanel = helper.getLinterPanel();
      if (linterPanel) {
        if (this.prevProblemAnchor) {
          this.prevProblemAnchor.parentNode.parentNode.parentNode.className = 'linter-elm-make-issue';
        }
        const problem = this.getProblemAtCursorPosition();
        if (problem) {
          let problemAnchor = linterPanel.getElementsByClassName(getAnchorForMessage(problem.filePath, problem.regionRange, problem.subregionRange));
          if (problemAnchor && problemAnchor.length > 0) {
            problemAnchor = problemAnchor[0];
            problemAnchor.scrollIntoView();
            problemAnchor.parentNode.parentNode.parentNode.className = 'linter-elm-make-issue-selected';
            this.prevProblemAnchor = problemAnchor;
          }
        } else {
          this.prevProblemAnchor = null;
        }
      }
    }
  },
  getProblemAtCursorPosition() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!helper.isElmEditor(editor)) {
      return null;
    }
    const position = editor.getLastCursor().getBufferPosition();
    // Look for problem at cursor position.
    const problems = this.problems[editor.getPath()];
    if (problems) {
      const problemsAtPosition =
        problems.filter(({range}) => {
          return range.containsPoint(position);
        });
      if (problemsAtPosition.length > 0) {
        // Get the most specific range.
        return _.min(problemsAtPosition,
          ({range}) => {
            return range.end.row - range.start.row;
          });
      }
    }
    return null;
  }
};

function createProgressIndicator() {
  const result = document.createElement('div');
  result.classList.add('inline-block');
  result.classList.add('icon-ellipsis');
  result.textContent = 'Linting...';
  return result;
}

function createQuickFixesIndicator() {
  const result = document.createElement('div');
  result.classList.add('inline-block');
  return result;
}

function getProjectBuildArtifactsDirectory(filePath) {
  if (filePath) {
    const projectDirectory = helper.lookupElmPackage(path.dirname(filePath));
    if (projectDirectory === null) {
      return null;
    }
    const executablePath = atom.config.get('linter-elm-make.elmMakeExecutablePath');
    return atomLinter.exec(executablePath, ['--help'], {
      stream: 'stdout',
      cwd: projectDirectory,
      env: process.env
    })
    .then(data => {
      let elmPlatformVersion = data.split('\n')[0].match(/\(Elm Platform (.+)\)/)[1];
      let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
      if (json) {
        if (json.repository && json.version) {
          const matches = json.repository.match(/^(.+)\/(.+)\/(.+)\.git$/);
          const user = (matches && matches.length > 2 && matches[2]) || null;
          const project = (matches && matches.length > 3 && matches[3]) || null;
          if (user && project) {
            return path.join(projectDirectory, 'elm-stuff', 'build-artifacts', elmPlatformVersion, user, project, json.version);
          } else {
            atom.notifications.addError('Could not determine the value of "user" and/or "project"', {dismissable: true});
          }
        } else {
          atom.notifications.addError('Field "repository" and/or "version" not found in elm-package.json', {dismissable: true});
        }
      } else {
        atom.notifications.addError('Error parsing elm-package.json', {dismissable: true});
      }
    })
    .catch(errorMessage => {
      atom.notifications.addError('Failed to run ' + executablePath, {
        detail: errorMessage,
        dismissable: true
      });
    });
  }
  return null;
}

function isASourceDirectoryOutsideProjectDirectory(projectDirectory) {
  const configWorkDirectory = atom.config.get('linter-elm-make.workDirectory');
  if (!atom.config.get('linter-elm-make.lintOnTheFly') && (!configWorkDirectory || configWorkDirectory.trim() === '')) {
    return false;
  }
  // If `Lint On The Fly` is enabled or `Work Directory` is set, it's not safe to have source directories outside of the project directory (e.g. "../src") since files might be modified/deleted.
  // Example: If the temporary work directory is `/tmp/aabbcc` and "source-directories" is ["../../"], that maps to the root directory!
  let json = fs.readJsonSync(path.join(projectDirectory, 'elm-package.json'), {throws: false});
  if (!json) {
    return true;
  }
  const sourceDirectories = json['source-directories'];
  if (!sourceDirectories) {
    return true;
  }
  const hasOutsideSource = sourceDirectories.find((sourceDirectory) => {
    const resolved = path.resolve(projectDirectory, sourceDirectory);
    return resolved !== projectDirectory && !resolved.startsWith(projectDirectory + path.sep);
  });
  if (hasOutsideSource) {
    atom.notifications.addError('A source directory is outside the project directory', {
      detail:
      'If `Lint On The Fly` is enabled or `Work Directory` is set, it is not safe to have source directories outside the project directory (e.g. "../src").\n' +
      'You can do one of the following:\n' +
      ' - Turn off "Lint On The Fly" in the package settings.\n' +
      ' - Unset "Work Directory" in the package settings.\n' +
      ' - Modify the "source-directories" field in the `elm-package.json` of the project to remove paths outside the project directory.',
      dismissable: true
    });
    return true;
  }
  return false;
}

function forceLintActiveElmEditor() {
  const editor = atom.workspace.getActiveTextEditor();
  if (helper.isElmEditor(editor)) {
    atom.commands.dispatch(atom.views.getView(editor), 'linter:lint');
  }
}

function refreshLintResultsOfActiveElmEditor() {
  const editor = atom.workspace.getActiveTextEditor();
  if (helper.isElmEditor(editor)) {
    // Toggle linter off then on again to refresh the lint results.
    [1, 2].forEach(() => {
      atom.commands.dispatch(atom.views.getView(editor), 'linter:toggle');
    });
  }
}

function getAnchorForMessage(filePath, regionRange, subregionRange) {
  return 'linter-elm-make://' + filePath + ':' + regionRange.start.row + ',' + regionRange.start.column +
    (subregionRange ? (':' + subregionRange.start.row + ',' + subregionRange.start.column) : '');
}

function showNoQuickFixesFound() {
  const detail = atom.config.get('linter-elm-make.lintOnTheFly') ? '' : 'If there was an edit after the last lint, you might need to lint again.';
  atom.notifications.addError('No quick fixes found', {
    detail: detail
  });
}

function destroyEditorMarkers(editorMarkers, editorId) {
  let markers = editorMarkers[editorId];
  if (markers) {
    markers.forEach((marker) => {
      marker.destroy();
    });
  }
}

function destroyAllMarkers(allMarkers) {
  Object.keys(allMarkers).forEach((editorId) => {
    destroyEditorMarkers(allMarkers, editorId);
  });
}
