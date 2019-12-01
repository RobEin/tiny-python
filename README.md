# Python starter &nbsp; 

A considerably stripped down Python grammar for a starter Python (or Python like) parser or even for educational purposes. 

The ANTLR4 grammars are based on the [Bart Kiers's Python 3.3 grammar](https://github.com/bkiers/python3-parser) with an improved indent/dedent handling with the following advantages:
-  warning for mixture of space and tab indentation
-  advanced token metadata information (see grun)
-  reusable code for grammar with actions and without actions
-  detection of inconsistent dedent (half dedent):
```python
    # for example
    if i == 1:
            j = 1
        k = 1
```

## How to use
### grammar with actions:
```bash
antlr4 Python3.g4
javac *.java
grun Python3 file_input -tokens test.py
```

### grammar without actions:
```bash
antlr4 Python3.g4
javac *.java
java Main test.py
```

## Related links

[ANTLR 4 Documentation](https://github.com/antlr/antlr4/blob/4.7.2/doc/index.md)

[The Python 3.3.7 Language Reference](https://docs.python.org/3.3/reference/grammar.html)

[Bart Kiers's Python 3.3 ANTLR4 grammar](https://github.com/bkiers/python3-parser)


