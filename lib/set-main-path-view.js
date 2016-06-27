'use babel';

const SelectListView = require('atom-space-pen-views').SelectListView;
const Emitter = require('atom').Emitter;

module.exports =
class SetMainPathView extends SelectListView {
  constructor() {
    super();
  }

  initialize() {
    super.initialize();
    this.addClass('overlay linter-elm-make');
    if (!this.panel) {
      this.panel = atom.workspace.addModalPanel({item: this, visible: false});
    }
    this.emitter = new Emitter();
  }

  destroy () {
    this.emitter.dispose();
    this.panel.destroy();
  }

  onDidConfirm(fn) {
    this.emitter.on('did-confirm', fn);
  }

  show(activeFilePath, projectDirectory, paths) {
    this.projectDirectory = projectDirectory;
    this.filterEditorView.getModel().setText(activeFilePath);
    this.filterEditorView.getModel().selectAll();
    this.setItems(paths);
    this.panel.show();
    this.storeFocusedElement();
    this.focusFilterEditor();
  }

  viewForItem(path) {
    return `<li><span>${path}</span></li>`;
  }

  confirmed(path) {
    this.emitter.emit('did-confirm', {projectDirectory: this.projectDirectory, mainPath: path});
    this.cancel();
  }

  cancelled(item) {
    this.panel.hide();
  }
};
