import org.antlr.v4.runtime.*;

public class Python3ErrorListener extends BaseErrorListener {
    private boolean isFirstTime = true;
    private LexerWithIndentDedentInjector lexer;

    public Python3ErrorListener(LexerWithIndentDedentInjector lexer) {
        this.lexer = lexer;
    }

    @Override
    public void syntaxError(Recognizer<?, ?> recognizer,
                            Object offendingSymbol,
                            int line, int charPositionInLine,
                            String msg,
                            RecognitionException e) {

        if (isFirstTime) {
            isFirstTime = false;
            System.err.println("ERROR:");
        }

        if (msg.startsWith(lexer._AT)) { // this is a custom error message from the lexer with pattern
            System.err.println(msg.substring(lexer._AT.length())); // displaying the trimmed ('@') lexer error message
        } else { // this is a parser error message
            String startOfMessage = "line " + line + ":" + charPositionInLine;
            if (msg.startsWith("missing INDENT")) {
                System.err.println(startOfMessage + "\t IndentationError: expected an indented block"); // displaying the modified parser error message
            } else if (msg.startsWith("extraneous input '<" + lexer._INSERTED_INDENT)) {
                System.err.println(startOfMessage + "\t IndentationError: unexpected indent"); // displaying the modified parser error message
            } else {
                System.err.println(startOfMessage + "\t at " + offendingSymbol + ": " + msg); // displaying the original parser error message
            }
        }
    }
}