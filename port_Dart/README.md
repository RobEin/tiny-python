### Dart implementation

#### Prerequisites:
- Installed [ANTLR4-tools](https://github.com/antlr/antlr4/blob/master/doc/getting-started.md#getting-started-the-easy-way-using-antlr4-tools)
- Installed [Dart](https://dart.dev/get-dart)

#### Command line example:
First download the dependencies then copy the two grammar files and the example.py to the current bin directory:
```bash
    dart pub get
    cd bin
```
Unix:
```bash
    cp ../../*.g4 .
    cp ../../example.py .
```
Windows:
```bash
    copy ..\..\*.g4
    copy ..\..\example.py
```
```bash
antlr4 -Dlanguage=Dart PythonLexer.g4
antlr4 -Dlanguage=Dart PythonParser.g4
dart dartgrun4py.dart example.py
```

#### Related link:
[Dart target](https://github.com/antlr/antlr4/blob/dev/doc/dart-target.md)
