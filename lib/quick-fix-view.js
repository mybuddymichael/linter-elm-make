"use babel";

const SelectListView = require('atom-space-pen-views').SelectListView;
const Emitter = require('atom').Emitter;

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
  }

  onDidConfirm(fn) {
    this.emitter.on('did-confirm', fn);
  }

  show(textEditor, range, fixes) {
    this.textEditor = textEditor;
    this.problemRange = range;
    this.setItems(fixes);
    this.panel.show();
    this.storeFocusedElement();
    this.focusFilterEditor();
  }

  viewForItem(fix) {
    return '<li><span class="fix-type">' + fix.type + ':</span>' + htmlEncode(fix.text.replace('\n', '\\n')) + '</li>';
  }

  confirmed(fix) {
    this.emitter.emit('did-confirm', {
      textEditor: this.textEditor,
      range: this.problemRange,
      fix: fix
    });
    this.cancel();
  }

  cancelled(item) {
    this.panel.hide();
  }
};

function htmlEncode(html) {
  return document.createElement('a').appendChild(document.createTextNode(html)).parentNode.innerHTML;
}
