// MYR amounts are integer sen everywhere; parsing avoids floating-point rounding.
export function moneyToMinor(value){if(!/^\d{1,8}(\.\d{1,2})?$/.test(value))throw Error('Enter a non-negative MYR price with up to two decimals.');const [whole,fraction='']=value.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(n>2147483647)throw Error('Price is too large.');return n;}
export const formatPrice=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(n/100);
