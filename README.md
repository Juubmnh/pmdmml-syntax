# pmdmml-syntax

Here is the extension "pmdmml-syntax" providing syntax highlighting and some small functions for M.Kajihara's Professional Music Driver MML.

## Highlighting

The syntax highlighting prompts are all taken from the PMDMML manual, but they don't quite match the common scopes of TextMate. I originally wrote some other scopes, which makes the theme need to be modified accordingly. Now text editor decoration is used instead. You can also make further modifications to the file `decoration.ts`.

## Definition Lookup

Supports cross-file search for instrument definition `.IDX` files. What may be confusing is that if a file contains multiple `#FFFile` directives, MC (PMDMML Compiler) will only adopt the last one.

## Configuration

* `pmdmml-syntax.batchPath`: represents a batch file used to compile your .MML file and carry out the action you want to take next, which can take the following as examples. It should be particularly noted that MC (PMDMML Compiler) does not support absolute paths and requires that the source file must be in a subfolder of the compiler folder.

```cmd
@echo off
pushd %~dp0
set dir=your_source_file_directory
msdos mc /v %dir%\%~nx1
if ERRORLEVEL 1 (pause & exit)
taskkill /f /im your_pmd_player 2>nul
start /min your_pmd_player %dir%\%~n1.m
popd
```

* `pmdmml-syntax-pattern*`: regular expressions available for matching similar syntaxes.

* `pmdmml-syntax-style*`: styles for regular expression matches. For simplicity, you can use a string in the specific form to mark the style you want.

```
Color Code | Font Style | Font Weight
e.g. #ffffff|italic|900
```

---

**Enjoy your music!**