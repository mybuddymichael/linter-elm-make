'use babel';

import * as React from 'react';
import quickFixing from './quick-fixing';

export default {
  create(
    { jsx, filePath, regionRange, type },
    fixesForRange,
    editor,
    highlightRegionRangeFunction,
    lowlightRegionRangeFunction,
    getFunctionsMatchingTypeFunction,
    showFunctionsMatchingTypeFunction
  ) {
    class IssueView extends React.PureComponent {
      render() {
        // return (
        //   <div
        //     className="datatip-marked"
        //     onMouseEnter={e =>
        //       highlightRegionRangeFunction(filePath, regionRange, type)}
        //     onMouseLeave={e => lowlightRegionRangeFunction()}
        //   >
        //     <div className="datatip-marked-container">{jsx}</div>
        //   </div>
        // );
        const fixesView = fixesForRange
          ? fixesForRange.fixes.map(fix => {
              return (
                <button
                  className="linter-elm-make-quick-fix-button"
                  onClick={e => {
                    const prevActivePane = atom.workspace.getActivePane();
                    quickFixing.fixProblem(
                      editor,
                      fixesForRange.range,
                      fix,
                      getFunctionsMatchingTypeFunction,
                      showFunctionsMatchingTypeFunction
                    );
                    prevActivePane.activate();
                  }}
                >
                  <span className="icon" />
                  <span className="fix-type">{fix.type + ': '}</span>
                  <span className="fix-text">{fix.text}</span>
                </button>
              );
            })
          : '';
        return (
          <div className="datatip-marked">
            <div className="datatip-marked-container">
              {jsx}
              <div className="linter-elm-make-quick-fixes">{fixesView}</div>
            </div>
          </div>
        );
      }
    }
    return IssueView;
  },
};
