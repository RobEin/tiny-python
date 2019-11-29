import java.util.*;

import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.CharStream;

public class Main {
	public static class IndentDedentInjector extends Python3Lexer {
		public IndentDedentInjector(CharStream input) {
			super(input);
		}

		// **** the following section is the same as the the grammar file with embedded code in @lexer::members{} section ****

		// The stack that keeps track of the indentation length with initializing the default indentation length 0.
		private final Stack<Integer> indentLengths = new Stack<>() {{
			push(0);
		}};

		// A queue where extra tokens are pushed on.
		private final Deque<Token> pendingTokens = new ArrayDeque<>();
		// An int that stores the type of the last inserted pending token.
		private int lastInsertedTokenType;

		// The amount of opened braces, brackets and parenthesis.
		private int opened = 0;

		// Was space char(s) in the indentations?
		private boolean wasSpaceIndentation = false;
		// Was TAB char(s) in the indentations?
		private boolean wasTabIndentation = false;

		@Override
		public Token nextToken() {                                           //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/Lexer.html#nextToken()
			if (getCharIndex() == 0) {  // We're at the start of the input.
				insertLeadingTokens();
			}

			Token currentToken;
			while (true) {
				currentToken = super.nextToken();
				switch (currentToken.getType()) {                            //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/Lexer.html#getType()
					case OPEN_PAREN:
					case OPEN_BRACK:
					case OPEN_BRACE:
						opened++;
						pendingTokens.addLast(currentToken);  // insert the open parentheses or square bracket or curly brace token
						break;
					case CLOSE_PAREN:
					case CLOSE_BRACK:
					case CLOSE_BRACE:
						opened--;
						pendingTokens.addLast(currentToken);  // insert the close parentheses or square bracket or curly brace token
						break;
					case NEWLINE:
						if (opened > 0) {                                    //*** https://docs.python.org/3/reference/lexical_analysis.html#implicit-line-joining
							continue;  // We're inside an implicit line joining section, skip the NEWLINE token.
						} else {
							switch (_input.LA(1) /* next symbol */) {        //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/IntStream.html#LA(int)
								case '\r':
								case '\n':
								case '\f':
								case '#':
									continue;  // We're on a blank line or before a comment, skip the NEWLINE token.
								default:
									pendingTokens.addLast(currentToken); // insert the NEWLINE token
									insertIndentDedentTokens();
							}
						}
						break;
					case EOF:
						if (indentLengths.size() > 0) {
							insertTrailingTokens();
							pendingTokens.addLast(currentToken); // insert the EOF token
							displayWarnings();
							System.out.println("");
						}
						break;
					default:
						pendingTokens.addLast(currentToken);
				}
				break; // exit from the "infinite" while loop
			}

			lastInsertedTokenType = pendingTokens.peekLast().getType();
			return pendingTokens.pollFirst();
		}

		private void insertLeadingTokens() {
			final String leadingSpacesAndTabs = getSpacesAndTabsFromTheCurrentPosition();
			if (!leadingSpacesAndTabs.isEmpty()) {
				final int currentIndentLength = getIndentationLength(leadingSpacesAndTabs);
				Token token;
				token = getNewToken(
						0,
						-1,
						leadingSpacesAndTabs,
						NEWLINE,
						1,
						0);

				pendingTokens.addLast(token);
				token = getNewToken(
						0,
						-1,
						"<inserted leading INDENT, " + getIndentationDescription(currentIndentLength) + ">",
						Python3Parser.INDENT,
						1,
						leadingSpacesAndTabs.length());

				pendingTokens.addLast(token);
				indentLengths.push(currentIndentLength);
				//System.err.println("ERROR:   line 1:" + leadingSpacesAndTabs.length() + " unexpected indent");
			}
		}

		private void insertIndentDedentTokens() {
			final int currentIndentLength = getIndentationLength(getText()); //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/TokenStream.html#getText()
			int previousIndentLength = indentLengths.peek();
			if (currentIndentLength > previousIndentLength) {
				insertToken("<inserted INDENT, " + getIndentationDescription(currentIndentLength) + ">", Python3Parser.INDENT);
				indentLengths.push(currentIndentLength); // in order after the insertToken!
			} else if (currentIndentLength < previousIndentLength) {
				// More than 1 DEDENT tokens may be inserted.
				do {
					indentLengths.pop(); // in order before the insertToken!
					previousIndentLength = indentLengths.peek();
					if (currentIndentLength <= previousIndentLength) {
						insertToken("<inserted DEDENT, " + getIndentationDescription(previousIndentLength) + ">", Python3Parser.DEDENT);
					} else {
						insertToken("!!! INCONSISTENT DEDENT !!! " + getIndentationDescription(currentIndentLength), Python3Parser.INCONSISTENT_DEDENT);
						System.err.println("ERROR:   line " + getLine() + ":" + getCharPositionInLine() + " inconsistent dedent");
					}
				} while (currentIndentLength < previousIndentLength);
			}
		}

		private void insertTrailingTokens() {
			switch (lastInsertedTokenType) {
				case NEWLINE:
				case Python3Parser.DEDENT:
				case Python3Parser.INCONSISTENT_DEDENT:
					break; // no new line is needed
				default:
					// insert an extra line break that serves as the end of the statement
					insertToken("<inserted trailing NEWLINE>", NEWLINE);
			}

			int previousIndentLength = indentLengths.peek();
			while (previousIndentLength != 0) {  // indentLengths stack has been initialized with integer 0
				indentLengths.pop();  // in order before the insertToken!
				previousIndentLength = indentLengths.peek();
				insertToken("<inserted trailing DEDENT, " + getIndentationDescription(previousIndentLength) + ">", Python3Parser.DEDENT);
			}
			indentLengths.pop();  // = removeAllElements(), indentLengths.size() is 0
		}

		private void displayWarnings() {
			getIndentationLength(getText());
			if (wasSpaceIndentation && wasTabIndentation) {
				System.out.println("WARNING: mixture of spaces and tabs were used for indentation");
			}
		}

		private CommonToken getNewToken(int startIndex, int stopIndex, String text, int type, int line, int charPositionInLine) {
			//*** metadata settings *** - display format in grun: [@TOKENNUMBER,startIndex:stopIndex='text','<type>',line:charPositionInLine]
			final var token = new CommonToken(type, text);                   //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/CommonToken.html
			token.setStartIndex(startIndex);                                 //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/CommonToken.html#setStartIndex(int)
			token.setStopIndex(stopIndex);                                   //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/CommonToken.html#setStopIndex(int)
			token.setLine(line);                                             //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/CommonToken.html#setLine(int)
			token.setCharPositionInLine(charPositionInLine);                 //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/CommonToken.html#setCharPositionInLine(int)
			return token;
		}

		private void insertToken(String text, int type) {
			final int startIndex = _tokenStartCharIndex + getText().length();//*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/Lexer.html#_tokenStartCharIndex
			final CommonToken token =
					getNewToken(startIndex,
							startIndex - 1,
							text,
							type,
							getLine(),                 //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/Lexer.html#getLine();
							getCharPositionInLine());  //*** https://www.antlr.org/api/Java/org/antlr/v4/runtime/Lexer.html#getCharPositionInLine()

			pendingTokens.addLast(token);
		}

		private String getIndentationDescription(int lengthOfIndent) {
			return "length=" + lengthOfIndent + ", level=" + (indentLengths.size());
		}

		private String getSpacesAndTabsFromTheCurrentPosition() {
			var spaces_and_tabs = new StringBuilder();
			int count = 1;
			char ch;

			while (true) {
				ch = (char) _input.LA(count);
				switch (ch) {
					case ' ':
					case '\t':
						spaces_and_tabs.append(ch);
						count++;
					default:
						return spaces_and_tabs.toString();
				}
			}
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
					case ' ':
						// A normal space char.
						wasSpaceIndentation = true;
						count++;
						break;
					case '\t':
						wasTabIndentation = true;
						count += 8 - (count % 8);
						break;
				}
			}

			return count;
		}
	}

	public static void main(String[] args) throws Exception {
		var input = CharStreams.fromFileName(args[0]);
		var lexer = new IndentDedentInjector(input);
		var tokens = new CommonTokenStream(lexer);
		var parser = new Python3Parser(tokens);
		RuleContext tree = parser.file_input();

		System.out.print(tree.toStringTree(parser));
	}
}
