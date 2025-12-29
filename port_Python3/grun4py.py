#!/usr/bin/env python3

# ******* GRUN (Grammar Unit Test) for Python *******

from antlr4 import FileStream, CommonTokenStream, Token
from PythonLexer import PythonLexer
from PythonParser import PythonParser
import sys
from typing import IO, Optional

def replace_special_characters(text: str) -> str:
    return text.replace('\n', r'\n') \
               .replace('\r', r'\r') \
               .replace('\t', r'\t') \
               .replace('\f', r'\f')

def format_token(token: Token) -> str:
    token_text = replace_special_characters(token.text)
    token_name = "EOF" if token.type == Token.EOF else PythonLexer.symbolicNames[token.type]
    channel_text = "" if token.channel == Token.DEFAULT_CHANNEL else \
                  f"channel={PythonLexer.channelNames[token.channel]},"

    # Modified format: [@TokenIndex,StartIndex:StopIndex='Text',<TokenName>,channel=channelName,Line:Column]
    return (f"[@{token.tokenIndex},{token.start}:{token.stop}='{token_text}',<{token_name}>,{channel_text}{token.line}:{token.column}]")

def main() -> int:
    try:
        if len(sys.argv) < 2:
            print("Error: Please provide an input file path")
            return 1

        file_path: str = sys.argv[1]
        input_stream: FileStream = FileStream(file_path, "utf-8")
        lexer: PythonLexer = PythonLexer(input_stream)
        token_stream: CommonTokenStream = CommonTokenStream(lexer)
        parser: PythonParser = PythonParser(token_stream)

        token_stream.fill()
        for token in token_stream.tokens:
            print(format_token
                  (token))
        
        parser.file_input()
        return parser.getNumberOfSyntaxErrors()
    except Exception as ex:
        print(f"Error: {str(ex)}", file=sys.stderr)
        return 1  # Error occurred, returning non-zero exit code

if __name__ == '__main__':
    sys.exit(main())
