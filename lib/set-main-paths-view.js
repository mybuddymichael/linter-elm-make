'use babel';

const {Emitter, CompositeDisposable} = require('atom');

export default class SetMainPathsView {

  constructor() {
    this.element = document.createElement('div');
    this.element.classList.add('linter-elm-make', 'set-main-paths');

    this.editorView = document.createElement('atom-text-editor');
    this.editorView.classList.add('atom-text-editor', 'linter-elm-make-set-main-paths');
    this.element.appendChild(this.editorView);
    this.editor = this.editorView.getModel();
    this.editor.setMini(true);

    this.modalPanel = atom.workspace.addModalPanel({
      item: this.element,
      visible: false
    });

    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(atom.commands.add('atom-text-editor.linter-elm-make-set-main-paths', {
      'blur': this.hide.bind(this),
      'linter-elm-make:cancel-set-main-paths':  this.hide.bind(this), // escape
      'linter-elm-make:confirm-set-main-paths': this.confirm.bind(this) // enter
    }));
  }

  destroy() {
    this.emitter.dispose();
    this.subscriptions.dispose();
    this.element.remove();
    this.modalPanel.destroy();
  }

  onDidConfirm(fn) {
    this.emitter.on('did-confirm', fn);
  }

  getElement() {
    return this.modalPanel;
  }

  show(activeFilePath, projectDirectory, mainPaths) {
    this.previouslyFocusedElement = document.activeElement;
    this.modalPanel.show();
    this.projectDirectory = projectDirectory;
    const activeFileIndex = mainPaths.indexOf(activeFilePath);
    if (activeFileIndex === -1) {
      mainPaths.push(activeFilePath);
    }
    const separator = ", ";
    const mainPathsString = mainPaths.join(separator);
    const selectColumnStart = mainPathsString.lastIndexOf(separator);
    this.editor.setText(mainPathsString);
    if (activeFileIndex !== -1) {
      this.editor.setCursorBufferPosition([mainPathsString.length, mainPathsString.length]);
    } else if (selectColumnStart !== -1) {
      this.editor.setSelectedBufferRange([[0, selectColumnStart + separator.length], [0, mainPathsString.length]]);
    } else {
      this.editor.selectAll();
    }
    this.editorView.focus();
  }

  hide() {
    this.modalPanel.hide();
    if (this.previouslyFocusedElement) {
      this.previouslyFocusedElement.focus();
    }
  }

  confirm() {
    const mainPaths = this.editor.getText().split(',').map((mainPath) => { return mainPath.trim(); });
    this.emitter.emit('did-confirm', {projectDirectory: this.projectDirectory, mainPaths: mainPaths});
    this.hide();
  }

}
