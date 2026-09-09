def classify(x, y):
    if x > 0:
        if y > 0:
            return "both"
        return "x only"
    elif y > 0 and x == 0:
        return "y only"
    return "neither"

def safe_div(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return None
    return "dead"


def describe_number(n):
    """Deliberately tangled so the fixture has something to untangle."""
    if n == 0:
        return "zero"
    if n < 0:
        if n % 2 == 0:
            return "negative even"
        return "negative odd"
    if n > 100 and n % 10 == 0:
        return "big round"
    if n > 100:
        return "big"
    if n % 2 == 0:
        return "even"
    return "odd"
