"""Tiny demo package."""
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def dist(self, other: "Point") -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t
