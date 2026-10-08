import { formatKes, kes } from '../src/domain/money';

describe('money', () => {
  it('stores shillings as whole cents', () => {
    expect(kes(4500)).toBe(450000);
    // 0.1 + 0.2 is 0.30000000000000004 as floats; cents stay exact.
    expect(kes(0.1) + kes(0.2)).toBe(kes(0.3));
  });

  it('formats cents for display', () => {
    expect(formatKes(450000)).toBe('KSh 4,500');
    expect(formatKes(450050)).toBe('KSh 4,500.50');
    expect(formatKes(123456789)).toBe('KSh 1,234,567.89');
    expect(formatKes(0)).toBe('KSh 0');
  });
});
