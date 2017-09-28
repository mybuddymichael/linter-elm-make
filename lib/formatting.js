'use babel';

// TODO: Add anchor tags to links.

import _ from 'underscore-plus';
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
  return (
    <span
      className={maybeAddActionableClass(
        'linter-elm-make-details-emphasis',
        props
      )}
      onMouseEnter={onMouseEnter(props)}
      onClick={onClick(props)}
    >
      {formatText(text)}
    </span>
  );
}

function formatInfo({ text, props }) {
  return (
    <span
      className={maybeAddActionableClass('linter-elm-make-details-info', props)}
      onMouseEnter={onMouseEnter(props)}
      onClick={onClick(props)}
    >
      {formatText(text)}
    </span>
  );
}

function formatExpectedType({ expected, actual, props }) {
  const diff = jsdiff.diffWords(formatType(actual), formatType(expected));
  const diffViews = diff.map(part => {
    if (part.added) {
      return (
        <span className="linter-elm-make-expected-type-diff-changed">
          {formatTypeParts(part.value, props)}
        </span>
      );
    } else if (!part.removed) {
      return <span>{formatTypeParts(part.value, props)}</span>;
    }
    return '';
  });
  return (
    <div className="linter-elm-make-details-expected-type">{diffViews}</div>
  );
}

function formatActualType({ expected, actual, props }) {
  const diff = jsdiff.diffWords(formatType(expected), formatType(actual));
  const diffViews = diff.map(part => {
    if (part.added) {
      return (
        <span className="linter-elm-make-actual-type-diff-changed">
          {formatTypeParts(part.value, props)}
        </span>
      );
    } else if (!part.removed) {
      return <span>{formatTypeParts(part.value, props)}</span>;
    }
    return '';
  });
  return <div className="linter-elm-make-details-actual-type">{diffViews}</div>;
}

function formatSuggestions({ suggestions, props }) {
  const suggestionsView = suggestions.map(suggestion => {
    return (
      <span>
        {formatTypeParts(suggestion, props)}
        <br />
      </span>
    );
  });
  return (
    <span className="linter-elm-make-details-suggestions">
      {suggestionsView}
    </span>
  );
}

function formatTypeParts(parts, props) {
  const lastIndex = parts.length - 1;
  return parts.split(' ').map((part, index) => {
    const maybeSpace = index === lastIndex ? '' : ' ';
    if (isAType(part.replace(/,$/, ''))) {
      return (
        <span>
          {formatTypePart(part, props)}
          {maybeSpace}
        </span>
      );
    } else {
      return formatText(part + maybeSpace);
    }
  });
}

function formatTypePart(text, props) {
  const parts = text.split(',');
  const lastIndex = parts.length - 1;
  return parts.map((part, index) => {
    if (part.length > 0) {
      return (
        <span>
          <span
            className="linter-elm-make-token-actionable"
            onMouseEnter={onMouseEnter(props, part)}
            onClick={onClick(props, part)}
          >
            {formatText(part)}
          </span>
          {index < lastIndex ? ',' : ''}
        </span>
      );
    }
    return '';
  });
}

function isAType(token) {
  if (['{', '}', ':', '->', '|', '(', ')'].includes(token)) {
    return false;
  }
  if (['number', 'appendable', 'comparable'].includes(token)) {
    // compappend?
    return true;
  }
  return token.length > 0 && token[0] === token[0].toUpperCase();
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

function formatIncorrectType({ text, props }) {
  return (
    <div className="linter-elm-make-details-actual-type">
      <span className="linter-elm-make-actual-type-diff-changed">
        {formatTypeParts(text, props)}
      </span>
    </div>
  );
}

function formatCorrectName({ text, props }) {
  return (
    <span className="linter-elm-make-details-expected-name">
      <span
        className={maybeAddActionableClass(
          'linter-elm-make-expected-name-diff-changed',
          props
        )}
        onMouseEnter={onMouseEnter(props)}
        onClick={onClick(props)}
      >
        {formatText(text)}
      </span>
    </span>
  );
}

function formatIncorrectName({ text, props }) {
  return (
    <span className="linter-elm-make-details-actual-name">
      <span
        className={maybeAddActionableClass(
          'linter-elm-make-actual-name-diff-changed',
          props
        )}
        onMouseEnter={onMouseEnter(props)}
        onClick={onClick(props)}
      >
        {formatText(text)}
      </span>
    </span>
  );
}

function formatHint({ parts }) {
  return (
    <div>
      <br />
      <span className="linter-elm-make-details-hint-label" />{' '}
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
  if (text.length === 0) {
    return '';
  }
  const parts = text.split(/\n/g);
  const lastIndex = parts.length - 1;
  return parts.map((part, index) => {
    const maybeLineBreak = index < lastIndex ? <br /> : '';
    return (
      <span>
        {part.replace(/ /g, '\u00a0')}
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

    case 'suggestions':
      return formatSuggestions(part);

    default:
      return formatDefault(part);
  }
}

function onMouseEnter(props, maybeToken) {
  return e => {
    if (props) {
      if (props.getTokenInfoFunction) {
        props.getTokenInfoFunction(maybeToken);
      }
    }
  };
}

function onClick(props, maybeToken) {
  return e => {
    if (props) {
      if (props.goToDefinitionFunction) {
        props.goToDefinitionFunction(maybeToken);
      }
      if (props.selectTokenFunction) {
        props.selectTokenFunction(maybeToken);
      }
    }
  };
}

function isActionable(props) {
  return (
    props &&
    (props.getTokenInfoFunction ||
      props.goToDefinitionFunction ||
      props.selectTokenFunction)
  );
}

function maybeAddActionableClass(className, props) {
  return (
    className + (isActionable(props) ? ' linter-elm-make-token-actionable' : '')
  );
}
