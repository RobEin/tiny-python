// ******* GRUN (Grammar Unit Test) for Python *******

using System.Text;
using Antlr4.Runtime;

namespace grun4py
{
    internal static class Program
    {
        public static int Main(string[] args)
        {
            if (args.Length < 1)
            {
                Console.Error.WriteLine("Error: Please provide an input file path");
                return 1;
            }

            try
            {
                var filePath = args[0];
                var input = CharStreams.fromPath(filePath, Encoding.GetEncoding("utf-8"));
                var lexer = new PythonLexer(input);
                var tokens = new CommonTokenStream((ITokenSource)lexer);
                var parser = new PythonParser(tokens);

                tokens.Fill(); // Test the lexer grammar
                foreach (IToken t in tokens.GetTokens())
                {
                    Console.WriteLine(FormatToken(t));
                }

                parser.file_input(); // Test the parser grammar
                return parser.NumberOfSyntaxErrors;

            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error: {ex.Message}");
                return 1; // Error occurred, returning non-zero exit code
            }
        }

        private static string FormatToken(IToken token)
        {
            string tokenText = ReplaceSpecialCharacters(token.Text);
            string tokenName = token.Type == TokenConstants.EOF ? "EOF" : PythonLexer.DefaultVocabulary.GetDisplayName(token.Type);
            string channelText = token.Channel == TokenConstants.DefaultChannel ?
                                 "" :
                                 $"channel={PythonLexer.channelNames[token.Channel]},";

            // Modified format: [@TokenIndex,StartIndex:StopIndex='Text',<TokenName>,channel=ChannelName,Line:Column]
            return $"[@{token.TokenIndex},{token.StartIndex}:{token.StopIndex}='{tokenText}',<{tokenName}>,{channelText}{token.Line}:{token.Column}]";
        }

        private static string ReplaceSpecialCharacters(string text)
        {
            return text.Replace("\n", @"\n")
                       .Replace("\r", @"\r")
                       .Replace("\t", @"\t")
                       .Replace("\f", @"\f");

        }
    }
}
