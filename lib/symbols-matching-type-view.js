'use babel';

import { SelectListView } from 'atom-space-pen-views';
import { Emitter } from 'atom';
import _ from 'underscore-plus';

module.exports = class SymbolsMatchingTypeView extends SelectListView {
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

  show(editor, range, symbols) {
    this.editor = editor;
    this.problemRange = range;
    this.setItems(
      symbols.map(symbol => {
        symbol.text = symbol.name + ' : ' + symbol.tipe;
        symbol.filterKey = symbol.text;
        return symbol;
      })
    );
    this.panel.show();
    this.storeFocusedElement();
    this.focusFilterEditor();
  }

  getFilterKey() {
    return 'filterKey';
  }

  viewForItem(symbol) {
    const text = _.escape(symbol.text.replace('\n', '\\n'));
    return `<li>${text}</li>`;
  }

  confirmed(symbol) {
    this.emitter.emit('did-confirm', {
      editor: this.editor,
      range: this.problemRange,
      symbol: symbol,
    });
    this.cancel();
  }

  cancelled(item) {
    this.panel.hide();
  }
};
