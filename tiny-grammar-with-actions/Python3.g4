/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Bart Kiers
 * Copyright (c) 2019 Robert Einhorn
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 *
 * Project      : Python3-parser; an ANTLR4 grammar for Python 3
 *                https://github.com/bkiers/Python3-parser
 * Developed by : Bart Kiers, bart@big-o.nl
 *
 * Project      : an ANTLR4 grammar for Tiny Python with embedded actions
 *                https://github.com/RobEin/python3-parser/tree/master/tiny-grammar-with-actions
 * Developed by : Robert Einhorn, robert.einhorn.hu@gmail.com
 */

// Based on the Bart Kiers's ANTLR4 Python 3.3 grammar: https://github.com/bkiers/Python3-parser
// and the Python 3.3.7 Language Reference:             https://docs.python.org/3.3/reference/grammar.html


grammar Python3; // tiny version

tokens { INDENT, DEDENT }


// this embedded code section will be copied to the generated file: Python3Lexer.java
@lexer::header {                                                     //*** https://github.com/antlr/antlr4/blob/master/doc/grammars.md#actions-at-the-grammar-level
import java.util.*;
}


// this embedded code section will be copied to the generated file: Python3Lexer.java
@lexer::members {
// The stack that keeps track of the indentation length
private final Stack<Integer> indentLengths = new Stack<>() {{ push(0); }}; // initializing with default 0 indentation length

// A queue where extra tokens are pushed on
private final Deque<Token> pendingTokens = new ArrayDeque<>();
// An integer that stores the type of the last appended token to the token stream
private int lastAppendedTokenType;

// The amount of opened braces, brackets and parenthesis
private int opened = 0;

// Was there space char in the indentations?
private boolean wasSpaceIndentation = false;
// Was there TAB char in the indentations?
private boolean wasTabIndentation = false;

// A string list that stores the lexer error messages
private List<String> errors = new ArrayList<>();
// A string list that stores the lexer warnings
private List<String> warnings = new ArrayList<>();

// Patterns for the custom error listener to recognize error messages
public final String _AT = "@";
public final String _INSERTED_INDENT = "inserted INDENT";

@Override
public Token nextToken() {
	final boolean atVeryFirstCharWhichIsSpaceOrTAB = getCharIndex() == 0 && List.of((int) ' ', (int) '\t').contains(_input.LA(1));
	Token currentToken;

	while (true) {
		currentToken = super.nextToken(); // get a token from the inputstream
		this.insertLeadingTokens(atVeryFirstCharWhichIsSpaceOrTAB, currentToken.getType(), currentToken.getStartIndex());
		switch (currentToken.getType()) {
			case OPEN_PAREN:
			case OPEN_BRACK:
			case OPEN_BRACE:
				this.opened++;
				this.pendingTokens.addLast(currentToken);  // insert the current open parentheses or square bracket or curly brace token
				break;
			case CLOSE_PAREN:
			case CLOSE_BRACK:
			case CLOSE_BRACE:
				this.opened--;
				this.pendingTokens.addLast(currentToken);  // insert the current close parentheses or square bracket or curly brace token
				break;
			case NEWLINE:
				if (this.opened > 0) {                             //*** https://docs.python.org/3/reference/lexical_analysis.html#implicit-line-joining
					continue;  // We're inside an implicit line joining section, skip the NEWLINE token
				} else {
					switch (_input.LA(1) /* next symbol */) {    //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/IntStream.html#LA(int)
						case '\r':
						case '\n':
						case '\f':
						case '#':                                  //*** https://docs.python.org/3/reference/lexical_analysis.html#blank-lines
							continue;  // We're on a blank line or before a comment, skip the NEWLINE token
						default:
							this.pendingTokens.addLast(currentToken); // insert the current NEWLINE token
							this.insertIndentDedentTokens();       //*** https://docs.python.org/3/reference/lexical_analysis.html#indentation
					}
				}
				break;
			case EOF:
				if ( !this.indentLengths.isEmpty() ) {
					this.insertTrailingTokens(); // indentLengths stack wil be empty
					this.pendingTokens.addLast(currentToken); // insert the current EOF token
				}
				break;
			default:
				this.pendingTokens.addLast(currentToken); // insert the current token
		}
		break; // exit from the loop
	}
	this.lastAppendedTokenType = this.pendingTokens.peekFirst().getType(); // save the token type before removing from the deque for the trailing tokens inserting later
	return this.pendingTokens.pollFirst(); // append a token to the token stream until the first returning EOF
}

private void insertLeadingTokens(boolean atVeryFirstCharWhichIsSpaceOrTAB, int type, int startIndex) {
	if (atVeryFirstCharWhichIsSpaceOrTAB &&   // We're at the first line of the input starting with a space or TAB
		!List.of(NEWLINE, EOF).contains(type) // and within that the first token that is visible (comments were skiped and OPEN_PAREN, OPEN_BRACK and OPEN_BRACE cannot be the first token)
	   ) {                                    // We need to insert a NEWLINE and an INDENT token before the first token to raise an 'unexpected indent' error by the parser later
		this.insertToken(0, startIndex - 1, "<inserted leading NEWLINE>" + " ".repeat(startIndex), NEWLINE, 1, 0);
		this.insertToken(startIndex, startIndex - 1, "<" + this._INSERTED_INDENT + ", " + this.getIndentationDescription(startIndex) + ">", Python3Parser.INDENT, 1, startIndex);
		this.indentLengths.push(startIndex);
	}
}

private void insertIndentDedentTokens() {
	final int currentIndentLength = this.getIndentationLength(getText());
	int previousIndentLength = this.indentLengths.peek();

	if (currentIndentLength > previousIndentLength) { // insert an INDENT token
		this.insertToken("<" + this._INSERTED_INDENT + ", " + this.getIndentationDescription(currentIndentLength) + ">", Python3Parser.INDENT);
		this.indentLengths.push(currentIndentLength);
	} else if (currentIndentLength < previousIndentLength) {
		do {   // More than 1 DEDENT token may be inserted
			this.indentLengths.pop();
			previousIndentLength = this.indentLengths.peek();
			if (currentIndentLength <= previousIndentLength) {
				this.insertToken("<inserted DEDENT, " + this.getIndentationDescription(previousIndentLength) + ">", Python3Parser.DEDENT);
			} else {
				this.insertToken("<inserted (I N C O N S I S T E N T!) DEDENT, " + this.getIndentationDescription(currentIndentLength) + ">", Python3Parser.DEDENT);
				this.errors.add(this._AT + "line " + getLine() + ":" + getCharPositionInLine() + "\t IndentationError: unindent does not match any outer indentation level");
			}
		} while (currentIndentLength < previousIndentLength);
	}
}

private void insertTrailingTokens() {
	if ( !List.of(NEWLINE, Python3Parser.DEDENT).contains(this.lastAppendedTokenType) ) { // If the last token was not NEWLINE or DEDENT then
		this.insertToken("<inserted trailing NEWLINE>", NEWLINE); // insert an extra trailing NEWLINE token that serves as the end of the statement
	}

	this.indentLengths.removeElementAt(0); // Remove the default 0 indentation length
	while ( !this.indentLengths.isEmpty() ) { // Now insert as much trailing DEDENT tokens as needed
		this.insertToken("<inserted trailing DEDENT, " + this.getIndentationDescription(this.indentLengths.pop()) + ">", Python3Parser.DEDENT);
	}
}

private void insertToken(String text, int type) {
	final int startIndex = _tokenStartCharIndex + getText().length(); //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/Lexer.html#_tokenStartCharIndex
	this.insertToken(startIndex, startIndex - 1, text, type, getLine(), getCharPositionInLine());
}

private void insertToken(int startIndex, int stopIndex, String text, int type, int line, int charPositionInLine) {
	CommonToken token = new CommonToken(_tokenFactorySourcePair, type, DEFAULT_TOKEN_CHANNEL, startIndex, stopIndex); //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/CommonToken.html
	token.setText(text);
	token.setLine(line);
	token.setCharPositionInLine(charPositionInLine);
	this.pendingTokens.addLast(token);
}

// Calculates the indentation of the provided spaces, taking the
// following rules into account:
//
// "Tabs are replaced (from left to right) by one to eight spaces
//  such that the total number of characters up to and including
//  the replacement is a multiple of eight [...]"
//
//  -- https://docs.python.org/3.1/reference/lexical_analysis.html#indentation
private int getIndentationLength(String textOfMatchedNEWLINE) {
	int count = 0;

	for (char ch : textOfMatchedNEWLINE.toCharArray()) {
		switch (ch) {
			case ' ': // A normal space char
				this.wasSpaceIndentation = true;
				count++;
				break;
			case '\t':
				this.wasTabIndentation = true;
				count += 8 - (count % 8);
				break;
		}
	}
	return count;
}

private String getIndentationDescription(int lengthOfIndent) {
	return "length=" + lengthOfIndent + ", level=" + (this.indentLengths.size());
}

public List<String> getErrorMessages() { // can be called from a grammar embedded action also
	return this.errors;
}

public List<String> getWarnings() { // can be called from a grammar embedded action also
	if (this.wasSpaceIndentation && this.wasTabIndentation) {
		this.warnings.add("Mixture of space and tab were used for indentation.");
	}
	return this.warnings;
}
}


/*
 * parser rules
 */

// startRules:
single_input: NEWLINE | simple_stmt | compound_stmt NEWLINE;
file_input:  (NEWLINE | stmt)* EOF;

stmt: simple_stmt | compound_stmt;

simple_stmt: small_stmt NEWLINE;
small_stmt: assignment_stmt | flow_stmt | print_stmt;
assignment_stmt: NAME '=' expr;
flow_stmt: break_stmt | continue_stmt;
break_stmt: 'break';
continue_stmt: 'continue';

compound_stmt: if_stmt | while_stmt;
if_stmt: 'if' test ':' suite ('elif' test ':' suite)* ('else' ':' suite)?;
while_stmt: 'while' test ':' suite;
suite: simple_stmt | NEWLINE INDENT stmt+ DEDENT;

test: expr (comp_op expr)*;  // differents from the original grammar
print_stmt: 'print' STRING | expr; // only for demonstration

comp_op: '<' | '>' | '==' | '>=' | '<=' | '!=';
expr:
   expr (( '+' | '-' ) expr)+
 | NAME
 | NUMBER
 | '(' expr ')'
;


/*
 * lexer rules
 */

STRING
 : STRING_LITERAL
 ;

NUMBER
 : INTEGER
 ;

INTEGER
 : DECIMAL_INTEGER
 ;

NEWLINE
 : ( '\r'? '\n' | '\r' | '\f' ) SPACES?
 ;

NAME
 : ID_START ID_CONTINUE*
 ;

STRING_LITERAL
 : '"' .*? '"' 
 ;

DECIMAL_INTEGER
 : NON_ZERO_DIGIT DIGIT*
 | '0'+
 ;

OPEN_PAREN : '(';
CLOSE_PAREN : ')';
OPEN_BRACK : '[';
CLOSE_BRACK : ']';
OPEN_BRACE : '{';
CLOSE_BRACE : '}';

SKIP_
 : ( SPACES | COMMENT | LINE_JOINING ) -> skip
 ;

UNKNOWN_CHAR
 : .
 ;


/* 
 * fragments 
 */

fragment NON_ZERO_DIGIT
 : [1-9]
 ;

fragment DIGIT
 : [0-9]
 ;

fragment SPACES
 : [ \t]+
 ;

fragment COMMENT
 : '#' ~[\r\n\f]*
 ;

fragment LINE_JOINING
 : '\\' SPACES? ( '\r'? '\n' | '\r' | '\f' )
 ;

fragment ID_START
 : '_'
 | [A-Z]
 | [a-z]
 ;

fragment ID_CONTINUE
 : ID_START
 | [0-9]
 ;