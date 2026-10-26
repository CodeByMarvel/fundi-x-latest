import { constants, publicEncrypt, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * `npm run b2c-credential -- <certificate.cer>`: makes the B2C Security
 * Credential (docs/mpesa.md §5) on this computer. Reads the initiator
 * password from MPESA_B2C_INITIATOR_PASSWORD in .env, encrypts it with
 * Safaricom's certificate, writes MPESA_B2C_SECURITY_CREDENTIAL and removes
 * the password line. Nothing secret is printed.
 */
const certPath = process.argv[2];
if (!certPath || !existsSync(certPath)) {
  console.error('Usage: npm run b2c-credential -- <path to Safaricom .cer certificate>');
  process.exit(1);
}
if (!existsSync('.env')) {
  console.error('No .env here: run this in the server folder');
  process.exit(1);
}

const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
const valueOf = (name: string) =>
  lines.find(l => l.startsWith(`${name}=`))?.slice(name.length + 1).trim() ?? '';

const password = valueOf('MPESA_B2C_INITIATOR_PASSWORD');
if (!password) {
  console.error('Add MPESA_B2C_INITIATOR_PASSWORD=<the initiator password> to .env first');
  process.exit(1);
}

// The certificate may come as PEM text or binary DER; X509Certificate reads both.
const certificate = new X509Certificate(readFileSync(certPath));
const credential = publicEncrypt(
  { key: certificate.publicKey, padding: constants.RSA_PKCS1_PADDING },
  Buffer.from(password),
).toString('base64');

const kept = lines.filter(
  l => !l.startsWith('MPESA_B2C_INITIATOR_PASSWORD=') && !l.startsWith('MPESA_B2C_SECURITY_CREDENTIAL='),
);
const end = kept.at(-1) === '' ? kept.length - 1 : kept.length;
kept.splice(end, 0, `MPESA_B2C_SECURITY_CREDENTIAL=${credential}`);
writeFileSync('.env', kept.join('\n'));

console.log(`MPESA_B2C_SECURITY_CREDENTIAL written (${credential.length} characters); password line removed.`);
console.log(`Certificate: ${certificate.subject.split('\n').find(l => l.startsWith('CN=')) ?? certificate.subject}`);
console.log('Restart the server to use it.');
