using System.Text;
using Antlr4.Runtime;

/// <summary>
/// GRUN (Grammar Unit Test) for Python
/// </summary>
public class Grun4py
{
    public static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Error: Please provide an input file path");
            return 1;
        }

        var filePath = args[0];
        try
        {
            var input = CharStreams.fromPath(filePath, Encoding.GetEncoding("utf-8"));
            PythonLexer lexer = new(input);
            CommonTokenStream tokens = new(lexer);
            PythonParser parser = new(tokens);

            tokens.Fill();
            foreach (IToken token in tokens.GetTokens())
            {
                Console.WriteLine(FormatToken(token));
            }

            parser.file_input();
            return parser.NumberOfSyntaxErrors;

        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error: " + ex.Message);
            Console.Error.WriteLine(ex.StackTrace);
            return 1;
        }
    }

    // ---------- Token formatting ----------
    private static string FormatToken(IToken token)
    {
        var tokenText = EscapeSpecialChars(token.Text);
        var tokenName = token.Type == TokenConstants.EOF
            ? "EOF"
            : PythonLexer.DefaultVocabulary.GetSymbolicName(token.Type);

        var channelName = token.Channel == TokenConstants.DefaultChannel
            ? ""
            : $"channel={token.Channel},";

        return $"[@{token.TokenIndex},{token.StartIndex}:{token.StopIndex}='{tokenText}',<{tokenName}>,{channelName}{token.Line}:{token.Column}]";
    }

    private static string EscapeSpecialChars(string text)
    {
        return text
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t")
            .Replace("\f", "\\f");
    }
}
