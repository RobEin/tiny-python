### Java 8 target

#### Command line example:
- first of all copy the two grammar files and the test.py to this directory

Unix:
```bash
    cp ../*.g4 .
```
```bash
    cp ../test.py .
```

Windows:
```bash
    copy ..\*.g4
```
```bash
    copy ..\test.py
```

```bash
antlr4 PythonLexer.g4
```
```bash
antlr4 PythonParser.g4
```
```bash
javac *.java
```
```bash
grun Python file_input -tokens test.py
```
```bash
grun Python file_input -gui test.py
```

#### Related link:
[Java target](https://github.com/antlr/antlr4/blob/master/doc/java-target.md)
