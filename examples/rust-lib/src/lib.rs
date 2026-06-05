/// Sum a slice via fold.
pub fn sum(xs: &[i64]) -> i64 {
    xs.iter().fold(0, |a, x| a + x)
}

#[derive(Debug, Clone)]
pub struct Counter { n: usize }

impl Counter {
    pub fn new() -> Self { Self { n: 0 } }
    pub fn tick(&mut self) -> usize { self.n += 1; self.n }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sums() { assert_eq!(sum(&[1, 2, 3]), 6); }
}
