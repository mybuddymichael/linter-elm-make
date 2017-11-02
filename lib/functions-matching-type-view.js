'use babel';

import { SelectListView } from 'atom-space-pen-views';
import { Emitter } from 'atom';
import _ from 'underscore-plus';

module.exports = class FunctionsMatchingTypeView extends SelectListView {
  constructor() {
    super();
  }

  initialize() {
    super.initialize();
    this.addClass('overlay linter-elm-make');
    if (!this.panel) {
      this.panel = atom.workspace.addModalPanel({ item: this, visible: false });
    }
    this.emitter = new Emitter();
  }

  destroy() {
    this.emitter.dispose();
    this.panel.destroy();
  }

  onDidConfirm(fn) {
    this.emitter.on('did-confirm', fn);
  }

  show(editor, range, functions) {
    this.editor = editor;
    this.problemRange = range;
    this.setItems(
      functions.map(func => {
        func.text = func.name + ' : ' + func.tipe;
        func.filterKey = func.text;
        return func;
      })
    );
    this.panel.show();
    this.storeFocusedElement();
    this.focusFilterEditor();
  }

  getFilterKey() {
    return 'filterKey';
  }

  viewForItem(func) {
    const text = _.escape(func.text.replace('\n', '\\n'));
    return `<li title="${'module ' + func.moduleName}">${text}</li>`;
  }

  confirmed(func) {
    this.emitter.emit('did-confirm', {
      editor: this.editor,
      range: this.problemRange,
      func,
    });
    this.cancel();
  }

  cancelled(item) {
    this.panel.hide();
  }
};
