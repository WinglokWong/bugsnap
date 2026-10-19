# Changelog

## 2.0.0 — Initial public release

- Added simple mode with Start recording, Mark a problem, and Finish and export.
- Added automatic click, input-state, choice, submission, scrolling, and SPA-navigation records.
- Added common page-message, native-dialog, validation, and loading-state observations.
- Added fetch/XHR start, completion, status, and timing summaries, including successful and unfinished requests.
- Followed websites visited in the recording window, including navigation from a new blank tab.
- Added optional start/marker/end screenshots and a combined HTML, JSON, and image ZIP.
- Preserved problem markers when screenshot capture fails.
- Drained pending input state and in-flight bridge messages before stopping.
- Excluded raw input values from action events and applied best-effort text filtering.
- Preserved older recording scopes during migration rather than silently expanding collection.
- Retained the previous manual reporting and comparison tools behind Advanced tools.

Validation: 59 logical tests, nine action/privacy browser checks, and six continuous-session browser checks passed during development. An actual downloaded sample ZIP was checked for HTML, JSON, and image integrity. Full v2 installed-extension and target-site acceptance testing remains outstanding.

## Earlier development versions

### 1.2.0

Persistent diagnostic sessions, cross-page continuation, child-tab tracking, local event storage, complete session export, permission-revocation handling, and manual stopping without the previous 15-minute timeout.

### 1.1.2

Local attachment of previously read diagnostic snapshots, clearer source-mismatch feedback, and snapshot recovery after reopening the panel.

### 1.1.1

Fixed toolbar access by opening the side panel from `action.onClicked`, and distinguished missing temporary access from restricted browser pages.

### 1.1.0

Added diagnostics, screenshot comparison, arrow annotations, offline HTML reports, page grouping, and severity filters.

### 1.0.0

Initial Chinese side panel, element selection, screenshots, rectangle/text annotations, local history, and Markdown/JSON exports.
