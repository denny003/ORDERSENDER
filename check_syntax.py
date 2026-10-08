with open('site/offer-app.js', 'r', encoding='utf-8') as f:
    text = f.read()

stack = []
i = 0
n = len(text)
line = 1
col = 1
while i < n:
    c = text[i]
    if c == '\n':
        line += 1
        col = 1
        i += 1
        continue
    # Single line comment
    if c == '/' and i + 1 < n and text[i+1] == '/':
        while i < n and text[i] != '\n':
            i += 1
        continue
    # Multi line comment
    if c == '/' and i + 1 < n and text[i+1] == '*':
        i += 2
        while i + 1 < n and not (text[i] == '*' and text[i+1] == '/'):
            if text[i] == '\n':
                line += 1
                col = 1
            i += 1
        i += 2
        continue
    # Regex literal: heuristic: preceded by ( = [ , : ! & | ? or line start
    if c == '/':
        # look back
        prev = text[:i].rstrip()
        if prev and prev[-1] in '(=[,:!&|?~':
            # regex literal
            i += 1
            in_bracket = False
            while i < n:
                if text[i] == '\n':
                    break
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == '[':
                    in_bracket = True
                elif text[i] == ']':
                    in_bracket = False
                elif text[i] == '/' and not in_bracket:
                    i += 1
                    # flags
                    while i < n and text[i].isalpha():
                        i += 1
                    break
                i += 1
            continue

    # Template strings / regular strings
    if c in ('"', "'", '`'):
        quote = c
        q_line = line
        i += 1
        while i < n:
            if text[i] == '\n':
                line += 1
                col = 1
            if text[i] == '\\':
                i += 2
                continue
            if text[i] == quote:
                i += 1
                break
            i += 1
        continue

    if c in '({[':
        stack.append((c, line, col))
    elif c in ')}]':
        if not stack:
            print(f'Extra closing {c} at line {line}:{col}')
        else:
            top, tl, tc = stack.pop()
            matches = {'(': ')', '{': '}', '[': ']'}
            if matches[top] != c:
                print(f'Mismatched {c} at line {line}:{col}, expected {matches[top]} for {top} from line {tl}:{tc}')
    i += 1
    col += 1

print(f'Total remaining open on stack: {len(stack)}')
for s in stack:
    print(f'  Unclosed {s[0]} opened at line {s[1]}:{s[2]}')
