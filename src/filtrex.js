const Jison = require("./lib/jison").Jison;

// Shared utility functions
const std = {
  isfn: function(fns, funcName) {
    return fns.hasOwnProperty(funcName) && typeof fns[funcName] === "function";
  },

  unknown: function(funcName) {
    throw ReferenceError("Unknown function: " + funcName + "()");
  },

  coerceArray: function(value) {
    if (Array.isArray(value)) return value;
    else return [value];
  },

  coerceBoolean: function(value) {
    if (typeof value === "boolean") return +value;
    else return value;
  },

  isSubset: function(a, b) {
    const A = std.coerceArray(a);
    const B = std.coerceArray(b);
    return +A.every(val => B.includes(val));
  },

  buildString: function(quote, literal) {
    quote = String(quote)[0];
    literal = String(literal);
    let built = "";

    if (literal[0] !== quote || literal[literal.length - 1] !== quote)
      throw new Error(
        `Unexpected internal error: String literal doesn't begin/end with the right quotation mark.`
      );

    for (let i = 1; i < literal.length - 1; i++) {
      if (literal[i] === "\\") {
        i++;
        if (i >= literal.length - 1)
          throw new Error(
            `Unexpected internal error: Unescaped backslash at the end of string literal.`
          );

        if (literal[i] === "\\") built += "\\";
        else if (literal[i] === quote) built += quote;
        else
          throw new Error(
            `Unexpected internal error: Invalid escaped character in string literal: ${literal[i]}`
          );
      } else if (literal[i] === quote) {
        throw new Error(
          `Unexpected internal error: String literal contains unescaped quotation mark.`
        );
      } else {
        built += literal[i];
      }
    }

    return JSON.stringify(built);
  }
};

/**
 * Filtrex provides compileExpression() to compile user expressions to JavaScript.
 *
 * See https://github.com/joewalnes/filtrex for tutorial, reference and examples.
 * MIT License.
 *
 * Includes Jison by Zachary Carter. See http://jison.org/
 *
 * -Joe Walnes
 */
exports.compileExpression = function compileExpression(expression, options) {
  // Check and coerce arguments

  if (arguments.length > 2) throw new TypeError("Too many arguments.");

  options = typeof options === "object" ? options : {};
  let { extraFunctions, customProp, async = false } = options;
  for (let key of Object.getOwnPropertyNames(options)) {
    if (!["extraFunctions", "customProp", "async"].includes(key))
      throw new TypeError(`Unknown option: ${key}`);
  }

  // Functions available to the expression

  let functions = {
    abs: Math.abs,
    ceil: Math.ceil,
    floor: Math.floor,
    log: Math.log,
    max: Math.max,
    min: Math.min,
    random: Math.random,
    round: Math.round,
    sqrt: Math.sqrt
  };

  if (extraFunctions) {
    for (var name in extraFunctions) {
      if (extraFunctions.hasOwnProperty(name)) {
        functions[name] = extraFunctions[name];
      }
    }
  }

  // Compile the parser

  if (!compileExpression.parser) {
    // Building the original parser is the heaviest part. Do it
    // once and cache the result in our own function.
    compileExpression.parser = filtrexParser();
    compileExpression.parser.yy = Object.create(std);
  }

  // Compile the expression

  let tree = compileExpression.parser.parse(expression);

  let js = [];
  js.push("return ");
  function toJs(node) {
    if (Array.isArray(node)) {
      node.forEach(toJs);
    } else {
      js.push(node);
    }
  }
  tree.forEach(toJs);
  js.push(";");

  // Metaprogramming functions

  function prop(name, obj) {
    return Object.prototype.hasOwnProperty.call(obj || {}, name)
      ? obj[name]
      : undefined;
  }

  function safeGetter(obj) {
    return function get(name) {
      return Object.prototype.hasOwnProperty.call(obj || {}, name)
        ? obj[name]
        : undefined;
    };
  }

  if (typeof customProp === "function") {
    prop = (name, obj) =>
      std.coerceBoolean(customProp(name, safeGetter(obj), obj));
  }

  // Patch together and return

  let func = new Function(
    `return ${async ? "async " : ""}function(fns, std, prop, data) { ${js.join("")} };`
  )();

  return function(data) {
    try {
      return func(functions, std, prop, data);
    } catch (e) {
      return e;
    }
  };
};

function filtrexParser() {
  // Language parser powered by Jison <http://zaach.github.com/jison/>,
  // which is a pure JavaScript implementation of
  // Bison <http://www.gnu.org/software/bison/>.

  function code(args, skipParentheses) {
    var argsJs = args
      .map(function(a) {
        return typeof a == "number" ? "$" + a : JSON.stringify(a);
      })
      .join(",");

    return skipParentheses
      ? "$$ = [" + argsJs + "];"
      : '$$ = ["(", ' + argsJs + ', ")"];';
  }

  var grammar = {
    // Lexical tokens
    lex: {
      rules: [
        ["\\*", 'return "*";'],
        ["\\/", 'return "/";'],
        ["-", 'return "-";'],
        ["\\+", 'return "+";'],
        ["\\^", 'return "^";'],
        ["\\%", 'return "%";'],
        ["\\(", 'return "(";'],
        ["\\)", 'return ")";'],
        ["\\,", 'return ",";'],
        ["==", 'return "==";'],
        ["=", 'return "==";'],
        ["\\!=", 'return "!=";'],
        ["\\~=", 'return "~=";'],
        [">=", 'return ">=";'],
        ["<=", 'return "<=";'],
        ["<", 'return "<";'],
        [">", 'return ">";'],
        ["\\?", 'return "?";'],
        ["\\:", 'return ":";'],
        ["and[^\\w]", 'return "and";'],
        ["or[^\\w]", 'return "or";'],
        ["not[^\\w]", 'return "not";'],
        ["in[^\\w]", 'return "in";'],
        ["of[^\\w]", 'return "of";'],
        ["true|false", 'return "BOOLEAN";'],

        ["await[^\\w]", 'return "await";'],

        ["\\s+", ""], // skip whitespace
        ["[0-9]+(?:\\.[0-9]+)?\\b", 'return "NUMBER";'], // 212.321

        [
          "[a-zA-Z$_][\\.a-zA-Z0-9$_]*",
          `yytext = JSON.stringify(yytext);
                  return "SYMBOL";`
        ], // some.Symbol22

        [
          `'(?:\\\\'|\\\\\\\\|[^'\\\\])*'`,
          `yytext = yy.buildString("'", yytext);
                  return "SYMBOL";`
        ], // 'any \'escaped\' symbol'

        [
          `"(?:\\\\"|\\\\\\\\|[^"\\\\])*"`,
          `yytext = yy.buildString('"', yytext);
                  return "STRING";`
        ], // "any \"escaped\" string"

        // End
        ["$", 'return "EOF";']
      ]
    },
    // Operator precedence - lowest precedence first.
    // See http://www.gnu.org/software/bison/manual/html_node/Precedence.html
    // for a good explanation of how it works in Bison (and hence, Jison).
    // Different languages have different rules, but this seems a good starting
    // point: http://en.wikipedia.org/wiki/Order_of_operations#Programming_languages
    operators: [
      ["left", "await"],
      ["left", "?", ":"],
      ["left", "or"],
      ["left", "and"],
      ["left", "in"],
      ["left", "==", "!=", "~="],
      ["left", "<", "<=", ">", ">="],
      ["left", "+", "-"],
      ["left", "*", "/", "%"],
      ["left", "^"],
      ["left", "not"],
      ["left", "UMINUS"],
      ["left", "of"]
    ],
    // Grammar
    bnf: {
      expressions: [
        // Entry point
        ["e EOF", "return $1;"]
      ],
      e: [
        ["e + e", code([1, "+", 3])],
        ["e - e", code([1, "-", 3])],
        ["e * e", code([1, "*", 3])],
        ["e / e", code([1, "/", 3])],
        ["e % e", code([1, "%", 3])],
        ["e ^ e", code(["Math.pow(", 1, ",", 3, ")"])],
        ["- e", code(["-", 2]), { prec: "UMINUS" }],
        ["e and e", code(["Number(", 1, "&&", 3, ")"])],
        ["e or e", code(["Number(", 1, "||", 3, ")"])],
        ["not e", code(["Number(!", 2, ")"])],
        ["e == e", code(["Number(", 1, "==", 3, ")"])],
        ["e != e", code(["Number(", 1, "!=", 3, ")"])],
        ["e ~= e", code(["Number(RegExp(", 3, ").test(", 1, "))"])],
        ["e < e", code(["Number(", 1, "<", 3, ")"])],
        ["e <= e", code(["Number(", 1, "<=", 3, ")"])],
        ["e > e", code(["Number(", 1, "> ", 3, ")"])],
        ["e >= e", code(["Number(", 1, ">=", 3, ")"])],
        ["e ? e : e", code([1, "?", 3, ":", 5])],
        ["( e )", code([2])],
        ["( array , e )", code(["[", 2, ",", 4, "]"])],
        ["BOOLEAN", code([1])],
        ["NUMBER", code([1])],
        ["STRING", code([1])],
        ["SYMBOL", code([`${async ? "await " : ""}prop(`, 1, ", data)"])],
        ["SYMBOL of e", code([`${async ? "await " : ""}prop(`, 1, ",", 3, ")"])],
        [
          "SYMBOL ( )",
          code([
            "(std.isfn(fns, ",
            1,
            `) ? ${async ? "await " : ""}fns[`,
            1,
            `]() : ${async ? "await " : ""}std.unknown(`,
            1,
            "))"
          ])
        ],
        [
          "SYMBOL ( argsList )",
          code([
            "(std.isfn(fns, ",
            1,
            `) ? ${async ? "await " : ""}fns[`,
            1,
            "](",
            3,
            `) : ${async ? "await " : ""}std.unknown(`,
            1,
            "))"
          ])
        ],
        ["e in e", code(["std.isSubset(", 1, ", ", 3, ")"])],
        ["e not in e", code(["+!std.isSubset(", 1, ", ", 4, ")"])]
      ],
      argsList: [
        ["e", code([1], true)],
        ["argsList , e", code([1, ",", 3], true)]
      ],
      inSet: [
        ["e", code(["o ==", 1], true)],
        ["inSet , e", code([1, "|| o ==", 3], true)]
      ],
      array: [
        ["e", code([1])],
        ["array , e", code([1, ",", 3], true)]
      ]
    }
  };
  return new Jison.Parser(grammar);
}
