# Python starter &nbsp; [![Build Status](https://travis-ci.org/bkiers/python3-parser.png)](https://travis-ci.org/bkiers/python3-parser)

A considerably stripped down Python grammar for a starter Python (or Python like) parser or even for educational purposes. 

The ANTLR4 grammars are based on the Bart Kiers's Python 3.3 grammar with improved indent/dedent handling with the following advantages:
 - detection of inconsistent dedent (half dedent)
 - warning for mixture of space and tab indentation
 - advanced token metadata information (see grun)
 - reusable code for grammar with actions and without actions
 

## How to use
USING of the grammar without action:

antlr4 Python3.g4

javac *.java

java Main test.py



USING of the grammar with action:
antlr4 Python3.g4
javac *.java
grun Python3 file_input -tokens test.py


## Related links

[The Python Language Reference](https://docs.python.org/3.3/reference/grammar.html)

[Bart Kiers's Python 3.3 ANTLR4 grammar](https://github.com/bkiers/python3-parser)


