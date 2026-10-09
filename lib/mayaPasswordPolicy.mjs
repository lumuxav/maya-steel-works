export function validateMayaPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return 'Password must be between 12 and 128 characters.'
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return 'Password must include uppercase and lowercase letters, a number, and a symbol.'
  }
  if (/^\s|\s$/.test(password)) {
    return 'Password cannot begin or end with a space.'
  }
  return null
}
