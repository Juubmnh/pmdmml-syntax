# Change Log

### 1.0.7

* Enhanced support for hexadecimal numbers.
* Grammar regular expressions no longer need to manually match decimal and hexadecimal respectively. `\d+` and `\d*` will be uniformly replaced with `(?:\\d+|\\$[0-9A-Fa-f]+)` and `(?:\d+|\$[0-9A-Fa-f]+)?`.
* Makes more accurate matches to the definitions of MML variables.

### 1.0.6

* Enhanced syntax highlighting.
* Improved hover display and definition lookup.
* Bug fixed.

### 1.0.4

* Regex bug fixed.

### 1.0.3

* Improved regex matching accuracy.
* Supports multiple SSG drum hover.
* Bug fixed.

### 1.0.2

* Regex bug fixed.

### 1.0.1

* Provides hover display and definition lookup for instrument names corresponding to the instrument numbers.
* A timbre trial mini-program has been added.
* Shortcut keys added.
* TextMate deprecated, and the built-in theme is no longer included. Highlighting style configuration together with the regular expressions for matching has been moved to settings.
* Bug fixed.

### 1.0.0

* Implemented basic syntax highlighting feature.
* Has a built-in Kanagawa theme modified from [barklan/kanagawa.vscode](https://github.com/barklan/kanagawa.vscode.git).