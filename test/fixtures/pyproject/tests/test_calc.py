from src.calc import classify, safe_div, describe_number

def test_both():
    assert classify(1, 1) == "both"

def test_x_only():
    assert classify(1, -1) == "x only"

def test_div():
    assert safe_div(4, 2) == 2
    assert safe_div(1, 0) is None


def test_describe_number():
    assert describe_number(0) == "zero"
    assert describe_number(-4) == "negative even"
    assert describe_number(-3) == "negative odd"
    assert describe_number(200) == "big round"
    assert describe_number(101) == "big"
    assert describe_number(4) == "even"
    assert describe_number(3) == "odd"
