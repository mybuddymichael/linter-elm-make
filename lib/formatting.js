'use babel';

// TODO: Add anchor tags to links.

import _ from 'underscore';
import * as React from 'react';
const jsdiff = require('diff');
import helper from './helper';

export default {
  format(overview, parts) {
    const partViews = parts.map(doFormat);
    return (
      <div>
        <div className="linter-elm-make-problem-overview">{overview}</div>
        <br />
        <div>{partViews}</div>
      </div>
    );
  },
};

function formatEmphasis({ text, props }) {
  const className =
    'linter-elm-make-details-emphasis' +
    (isActionable(props) ? ' linter-elm-make-token-actionable' : '');
  return (
    <span
      className={className}
      onMouseEnter={onMouseEnter(props)}
      onClick={onClick(props)}
    >
      {formatText(text)}
    </span>
  );
}

function formatInfo({ text }) {
  return (
    <span className="linter-elm-make-details-info">{formatText(text)}</span>
  );
}

function formatExpectedType({ expected, actual }) {
  const diff = jsdiff.diffWords(formatType(actual), formatType(expected));
  const diffViews = diff.map(part => {
    if (part.added) {
      return (
        <span className="linter-elm-make-expected-type-diff-changed">
          {formatText(part.value)}
        </span>
      );
    } else if (!part.removed) {
      return <span>{formatText(part.value)}</span>;
    }
    return '';
  });
  return (
    <div className="linter-elm-make-details-expected-type">{diffViews}</div>
  );
}

function formatActualType({ expected, actual }) {
  const diff = jsdiff.diffWords(formatType(expected), formatType(actual));
  const diffViews = diff.map(part => {
    if (part.added) {
      return (
        <span className="linter-elm-make-actual-type-diff-changed">
          {formatText(part.value)}
        </span>
      );
    } else if (!part.removed) {
      return <span>{formatText(part.value)}</span>;
    }
    return '';
  });
  return <div className="linter-elm-make-details-actual-type">{diffViews}</div>;
}

function formatExpectedName({ expected, actual }) {
  const diff = jsdiff.diffChars(actual, expected);
  const diffViews = diff.map(part => {
    if (part.added) {
      return (
        <span className="linter-elm-make-expected-name-diff-changed">
          {formatText(part.value)}
        </span>
      );
    } else if (!part.removed) {
      return <span>{formatText(part.value)}</span>;
    }
    return '';
  });
  return (
    <span className="linter-elm-make-details-expected-name">{diffViews}</span>
  );
}

function formatActualName({ expected, actual }) {
  const diff = jsdiff.diffChars(expected, actual);
  const diffViews = diff.map(part => {
    if (part.added) {
      return (
        <span className="linter-elm-make-actual-name-diff-changed">
          {formatText(part.value)}
        </span>
      );
    } else if (!part.removed) {
      return <span>{formatText(part.value)}</span>;
    }
    return '';
  });
  return (
    <span className="linter-elm-make-details-actual-name">{diffViews}</span>
  );
}

function formatIncorrectType({ text }) {
  return (
    <div className="linter-elm-make-details-actual-type">
      <span className="linter-elm-make-actual-type-diff-changed">
        {formatType(text)}
      </span>
    </div>
  );
}

function formatCorrectName({ text }) {
  return (
    <span className="linter-elm-make-details-expected-name">
      <span className="linter-elm-make-expected-name-diff-changed">
        {formatText(text)}
      </span>
    </span>
  );
}

function formatIncorrectName({ text }) {
  return (
    <span className="linter-elm-make-details-actual-name">
      <span className="linter-elm-make-actual-name-diff-changed">
        {formatText(text)}
      </span>
    </span>
  );
}

function formatHint({ parts }) {
  const space = ' ';
  return (
    <div>
      <br />
      <span className="linter-elm-make-details-hint-label" />
      {space}
      <span className="linter-elm-make-details-hint">
        {parts.map(doFormat)}
      </span>
    </div>
  );
}

function formatUrl({ text }) {
  return <a href="{text}">{formatText(text)}</a>;
}

function formatDefault({ text }) {
  return formatText(text);
}

function formatText(text) {
  const parts = text.split(/\n/g);
  const lastIndex = parts.length - 1;
  return parts.map((part, index) => {
    const maybeLineBreak = index < lastIndex ? <br /> : '';
    return (
      <span>
        {part}
        {maybeLineBreak}
      </span>
    );
  });
}

function formatType(type) {
  return type
    .split('\n')
    .map(line => {
      return line.replace(helper.tabSpaces(), '');
    })
    .join('\n');
}

function doFormat(part) {
  switch (part.type) {
    case 'emphasis':
      return formatEmphasis(part);

    case 'info':
      return formatInfo(part);

    case 'correctName':
      return formatCorrectName(part);

    case 'incorrectName':
      return formatIncorrectName(part);

    case 'expectedName':
      return formatExpectedName(part);

    case 'actualName':
      return formatActualName(part);

    case 'incorrectType':
      return formatIncorrectType(part);

    case 'expectedType':
      return formatExpectedType(part);

    case 'actualType':
      return formatActualType(part);

    case 'url':
      return formatUrl(part);

    case 'hint':
      return formatHint(part);

    default:
      return formatDefault(part);
  }
}

function onMouseEnter(props) {
  return e => {
    if (isActionable(props)) {
      props.getTokenInfoFunction();
    }
  };
}

function onClick(props) {
  return e => {
    if (isActionable(props)) {
      props.goToDefinitionFunction();
    }
  };
}

function isActionable(props) {
  return props && (props.getTokenInfoFunction || props.goToDefinitionFunction);
}
