// Helper
export function convertStringToNumberOrZero(str: string): number {

  const number = +str;

  if(Number.isNaN(number)) {
    return 0;
  }

  return number;
}

export function reverse(map: Record<any, any>) {
  const res: Record<any, any> = {};

  Object.keys(map).forEach(function(key) {
    const newKey = convertStringToNumberOrZero(key);

    const value = map[newKey];
    res[value] = newKey;
  });

  return res;
}
