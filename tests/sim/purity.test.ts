import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * The rules engine stays pure and deterministic (§6, implementation plan §2.3). `tsconfig.sim.json` type-checks
 * src/sim with only the ES2022 library, so no browser or Node API even has a type there; this test reads the syntax
 * (comments and strings don't count) for what that library still offers: the clock, unseeded randomness, functions
 * that may round differently between engines, and ways round the checks. It also walks the imports from
 * src/sim/index.ts, which may reach only src/sim, src/level and src/gen, and must reach every file of src/sim (a file
 * that isn't imported never registers its commands).
 */

const ROOT = resolve(__dirname, '../..');
const SIM = join(ROOT, 'src/sim');
const ALLOWED = ['src/sim/', 'src/level/', 'src/gen/'];

/** Globals the rules may not name. */
const BANNED_GLOBALS = new Set(['Date', 'globalThis', 'performance', 'crypto', 'window', 'document', 'self', 'navigator', 'process', 'eval', 'Function', 'Intl']);

/** Math functions that aren't exactly rounded, so may differ in the last bit between engines; and Math.random. */
const BANNED_MATH = new Set([
    'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'cbrt', 'hypot'
]);

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

const parse = (path: string): ts.SourceFile => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);

/** Whether an identifier names something in scope (not a property name, a key or a declaration's member name). */
function isReference(node: ts.Identifier): boolean {
    const p = node.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)
        || ts.isMethodSignature(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === node) return false;
    if (ts.isQualifiedName(p) && p.right === node) return false;
    return true;
}

function problems(source: ts.SourceFile): string[] {
    const found: string[] = [];
    const at = (node: ts.Node, what: string): void => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${relative(ROOT, source.fileName)}:${line + 1}: ${what}`);
    };
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && isReference(node)) {
            if (BANNED_GLOBALS.has(node.text)) at(node, node.text);
            if (node.text === 'Math') {
                const p = node.parent;
                if (ts.isPropertyAccessExpression(p) && p.expression === node) {
                    if (BANNED_MATH.has(p.name.text)) at(node, `Math.${p.name.text}`);
                } else at(node, ts.isElementAccessExpression(p) ? 'computed Math access' : 'Math used as a value');
            }
        }
        if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken
            || node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken)) at(node, '** (Math.pow)');
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

/** The module specifiers a file imports or re-exports, static or dynamic. */
function imports(source: ts.SourceFile): string[] {
    const out: string[] = [];
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            out.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
            const arg = node.arguments[0];
            out.push(arg && ts.isStringLiteral(arg) ? arg.text : '<computed import>');
        }
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) out.push(node.argument.literal.text);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

function resolveImport(from: string, spec: string): string | undefined {
    const base = resolve(dirname(from), spec);
    return [base, `${base}.ts`, join(base, 'index.ts')].find(p => existsSync(p) && statSync(p).isFile());
}

describe('src/sim', () => {
    const all = files(SIM).filter(f => f.endsWith('.ts'));

    it('names no clock, no unseeded randomness and no engine-dependent maths', () => {
        expect(all.length).toBeGreaterThan(5);
        expect(all.flatMap(f => problems(parse(f)))).toEqual([]);
    });

    it('catches what it is meant to, and only in code', () => {
        const probe = ts.createSourceFile('probe.ts', [
            '// Date.now() and Math.random() in a comment are fine, and so is a teller window.',
            "const s = 'Math.sin in a string, the window';",
            'const a = Date.now(), b = Math.random(), c = Math.atan2(1, 2), d = Math["floor"](1), e = globalThis;',
            'const f = performance.now(), g = 2 ** 3, M = Math, ok = Math.floor(Math.sqrt(2)), o = { Date: 1 }.Date;'
        ].join('\n'), ts.ScriptTarget.ES2022, true);
        expect(problems(probe).map(p => p.replace(/^.*: /, ''))).toEqual([
            'Date', 'Math.random', 'Math.atan2', 'computed Math access', 'globalThis', 'performance', '** (Math.pow)', 'Math used as a value'
        ]);
    });

    it('imports only the pure parts of the game, and every file of the engine is loaded', () => {
        const seen = new Set<string>(), bad: string[] = [];
        const walk = (path: string): void => {
            if (seen.has(path)) return;
            seen.add(path);
            for (const spec of imports(parse(path))) {
                if (!spec.startsWith('.')) {
                    bad.push(`${relative(ROOT, path)} imports the package '${spec}'`);
                    continue;
                }
                const target = resolveImport(path, spec);
                const rel = target && relative(ROOT, target).split('\\').join('/');
                if (!target || !rel || !ALLOWED.some(dir => rel.startsWith(dir))) bad.push(`${relative(ROOT, path)} imports '${spec}'`);
                else walk(target);
            }
        };
        walk(join(SIM, 'index.ts'));
        expect(bad).toEqual([]);
        expect(all.filter(f => !seen.has(f)).map(f => relative(ROOT, f))).toEqual([]);
    });
});
