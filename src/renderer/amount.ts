export function monthlyUsdToCents(value: string) {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a monthly cap with at most two decimal places.');
    const [dollars, fraction = ''] = value.split('.');
    const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000) throw new Error('Enter a monthly cap from $0.01 to $1,000.00. A zero cap disables the upstream budget policy.');
    return cents;
}
