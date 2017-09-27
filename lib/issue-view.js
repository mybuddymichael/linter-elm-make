'use babel';

import * as React from 'react';

export default {
  create(
    { jsx, filePath, regionRange, type },
    highlightRegionRangeFunction,
    lowlightRegionRangeFunction
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
        return (
          <div className="datatip-marked">
            <div className="datatip-marked-container">{jsx}</div>
          </div>
        );
      }
    }
    return IssueView;
  },
};
