import { scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { stdin, stdout } from 'node:process';
import { neon } from '@neondatabase/serverless';

const scrypt = promisify(scryptCallback);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const categories = [
  ['Salaire', 'income'],
  ['Autres revenus', 'income'],
  ['Logement', 'expense'],
  ['Alimentation', 'expense'],
  ['Transport', 'expense'],
  ['Santé', 'expense'],
  ['Dettes', 'expense'],
  ['Abonnements', 'expense'],
  ['Projets', 'expense'],
  ['Autres', 'expense'],
];

async function askHidden(question) {
  if (!stdin.isTTY) throw new Error('Cette commande doit être lancée dans un terminal interactif sécurisé.');

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';

  try {
    for await (const chunk of stdin) {
      const character = chunk.toString('utf8');
      if (character === '\u0003') throw new Error('Opération annulée.');
      if (character === '\r' || character === '\n') break;
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    }
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
  }

  return value;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL est requise. Configurez la connexion PostgreSQL avant de créer le compte.');
  }

  const email = (await askHidden('Adresse courriel du propriétaire : ')).trim().toLowerCase();
  if (!emailPattern.test(email)) throw new Error('Adresse courriel invalide.');

  const password = await askHidden('Nouveau mot de passe (12 caractères minimum) : ');
  const confirmation = await askHidden('Confirmer le mot de passe : ');
  if (password.length < 12 || password.length > 200) {
    throw new Error('Le mot de passe doit comporter entre 12 et 200 caractères.');
  }
  if (password !== confirmation) throw new Error('Les mots de passe ne correspondent pas.');

  const sql = neon(process.env.DATABASE_URL);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
  const createdCategories = await sql`
    WITH owner AS (
      INSERT INTO app_user (email, password_hash, currency_code, timezone)
      VALUES (${email}, ${`${salt}:${passwordHash}`}, 'XOF', 'Africa/Abidjan')
      RETURNING id
    ),
    defaults AS (
      SELECT name, kind
      FROM jsonb_to_recordset(${JSON.stringify(categories.map(([name, kind]) => ({ name, kind })))}::jsonb)
        AS item(name text, kind text)
    )
    INSERT INTO category (owner_id, name, kind, is_default)
    SELECT owner.id, defaults.name, defaults.kind, true
    FROM owner CROSS JOIN defaults
    RETURNING id
  `;
  if (createdCategories.length !== categories.length) {
    throw new Error('La création des catégories par défaut est incomplète.');
  }

  stdout.write('Compte propriétaire créé. Le mot de passe n’a été ni affiché ni enregistré dans le dépôt.\n');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
