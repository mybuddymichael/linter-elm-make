"use babel";

import {SelectListView} from 'atom-space-pen-views';
import {Emitter} from 'atom';
import _ from 'underscore';

module.exports =
class QuickFixView extends SelectListView {
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

  show(editor, range, fixes) {
    this.editor = editor;
    this.problemRange = range;
    this.setItems(fixes.map((fix) => {
      fix.filterKey = fix.type + ': ' + fix.text;
      return fix;
    }));
    this.panel.show();
    this.storeFocusedElement();
    this.focusFilterEditor();
  }

  getFilterKey() {
    return 'filterKey';
  }

  viewForItem(fix) {
    const text = _.escape(fix.text.replace('\n', '\\n'));
    return `<li><span class="fix-type">${fix.type}:</span>${text}</li>`;
  }

  confirmed(fix) {
    this.emitter.emit('did-confirm', {
      editor: this.editor,
      range: this.problemRange,
      fix: fix
    });
    this.cancel();
  }

  cancelled(item) {
    this.panel.hide();
  }
};
