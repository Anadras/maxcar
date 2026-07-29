import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { STATE_PATH, type E2EState } from './state';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.describe.configure({ mode: 'serial' });

test('operational flow: login through fleet, without touching the database directly', async ({
  page,
}) => {
  expect(existsSync(STATE_PATH)).toBe(true);
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as E2EState;
  const stamp = Date.now();

  // 1. Login
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(state.email);
  await page.getByLabel('Senha').fill(state.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/');

  // 2. Cliente
  await page.goto('/clientes/novo');
  await page.getByLabel('Razão social').fill(`E2E - Cliente Ltda ${stamp}`);
  await page.getByLabel('Nome fantasia').fill(`E2E - Cliente ${stamp}`);
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page).toHaveURL(/\/clientes\/[0-9a-f-]+/);
  await expect(
    page.getByRole('heading', { name: `E2E - Cliente ${stamp}` }),
  ).toBeVisible();

  // 3. Estabelecimento (hub quick action pre-selects the client)
  await page.getByRole('link', { name: '＋ Novo estabelecimento' }).click();
  await expect(page).toHaveURL(/\/estabelecimentos\/novo\?advertiser=/);
  await page.getByLabel('Nome da unidade').fill(`E2E - Loja ${stamp}`);
  await page.getByLabel('Logradouro').fill('Av. Afonso Pena, 1000');
  await page.getByLabel('Cidade').fill('Campo Grande');
  await page.getByLabel('UF').fill('MS');
  await page.getByLabel('Latitude').fill('-20.4697');
  await page.getByLabel('Longitude').fill('-54.6201');
  await page.getByRole('button', { name: 'Salvar estabelecimento' }).click();
  await expect(page).toHaveURL(/\/estabelecimentos\/[0-9a-f-]+/);
  await expect(
    page.getByRole('heading', { name: `E2E - Loja ${stamp}` }),
  ).toBeVisible();

  // 4. Campanha GEO (hub quick action pre-selects client + type=geo)
  await page.getByRole('link', { name: '＋ Nova campanha GEO' }).click();
  await expect(page).toHaveURL(/\/campanhas\/nova\?advertiser=.*type=geo/);
  await expect(page.getByLabel('Tipo')).toHaveValue('geo');
  await page.getByLabel('Nome da campanha').fill(`E2E - Campanha GEO ${stamp}`);
  const startsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const toLocalInput = (date: Date) => date.toISOString().slice(0, 16);
  await page.getByLabel('Início').fill(toLocalInput(startsAt));
  await page.getByLabel('Fim').fill(toLocalInput(endsAt));
  await page.getByRole('button', { name: 'Salvar campanha' }).click();
  await expect(page).toHaveURL(/\/campanhas\/[0-9a-f-]+/);
  const campaignPath = new URL(page.url()).pathname;
  await expect(page.getByText('Campanha ainda incompleta')).toBeVisible();

  // 5. Criativo
  const dir = mkdtempSync(join(tmpdir(), 'maxcar-e2e-'));
  const filePath = join(dir, 'creative.png');
  writeFileSync(filePath, Buffer.from(PNG_BASE64, 'base64'));
  await page.getByLabel('Nome do criativo').fill('E2E creative');
  await page.getByLabel('Duração de exibição em segundos').fill('8');
  await page.locator('input[name="file"]').setInputFiles(filePath);
  await page.getByRole('button', { name: 'Enviar criativo' }).click();
  await expect(page.getByText('E2E creative')).toBeVisible();

  // 6. Geofence (pre-selects the campaign; establishment picked by name)
  await page.getByRole('link', { name: '＋ Adicionar geofence' }).click();
  await expect(page).toHaveURL(/\/geofences\/nova\?campaign=/);
  const establishmentSelect = page.getByLabel('Estabelecimento');
  const establishmentValue = await establishmentSelect
    .locator('option', { hasText: `E2E - Loja ${stamp}` })
    .getAttribute('value');
  await establishmentSelect.selectOption(establishmentValue!);
  await page.getByLabel('Raio em metros').fill('500');
  await page.getByRole('button', { name: 'Salvar geofence' }).click();
  await expect(page).toHaveURL(/\/geofences\/[0-9a-f-]+/);

  // 7. Ativação — back on the campaign, readiness must now be green
  await page.goto(campaignPath);
  await expect(page.getByText('Campanha estruturalmente pronta')).toBeVisible();
  await page.getByRole('link', { name: 'Editar campanha' }).click();
  await expect(page.getByText('Campanha estruturalmente pronta')).toBeVisible();
  await page.getByLabel('Status').selectOption('active');
  await page.getByRole('button', { name: 'Salvar campanha' }).click();
  await expect(page).toHaveURL(
    new RegExp(campaignPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  const summarySection = page.locator('section', { hasText: 'Resumo' });
  await expect(
    summarySection.getByText('Ativa', { exact: true }),
  ).toBeVisible();

  // 8. Motorista
  await page.goto('/motoristas/novo');
  await page.getByLabel('Nome completo').fill(`E2E - Motorista ${stamp}`);
  await page.getByLabel('Status').selectOption('active');
  await page.getByRole('button', { name: 'Salvar motorista' }).click();
  await expect(page).toHaveURL(/\/motoristas\/[0-9a-f-]+/);
  const driverUrl = page.url();
  await expect(page.getByText('Sem veículo vinculado')).toBeVisible();

  // 9. Veículo (quick action from the driver page pre-selects the driver)
  await page.getByRole('link', { name: '＋ Adicionar veículo' }).click();
  await expect(page).toHaveURL(/\/veiculos\/novo\?driver=/);
  const vehicleCode = `CAR-E2E${stamp % 10000}`;
  await page.getByLabel('Código interno').fill(vehicleCode);
  await page.getByLabel('Placa').fill('TST1D23');
  await page.getByRole('button', { name: 'Salvar veículo' }).click();
  await expect(page).toHaveURL(/\/veiculos\/[0-9a-f-]+/);
  const vehicleUrl = page.url();
  await expect(page.getByText(`E2E - Motorista ${stamp}`)).toBeVisible();

  // 10. Dispositivo (quick action from the vehicle page pre-selects the vehicle)
  await page.getByRole('link', { name: '＋ Instalar tablet' }).click();
  await expect(page).toHaveURL(/\/dispositivos\/novo\?vehicle=/);
  const deviceCode = `TB-E2E${stamp % 10000}`;
  await page.getByLabel('Código operacional').fill(deviceCode);
  await page.getByRole('button', { name: 'Salvar dispositivo' }).click();
  await expect(page).toHaveURL(/\/dispositivos\/[0-9a-f-]+/);
  await expect(page.getByText(vehicleCode)).toBeVisible();

  // Cross-check: the vehicle now shows the installed tablet.
  await page.goto(vehicleUrl);
  await expect(page.getByText(deviceCode)).toBeVisible();

  // Cross-check: the driver page shows the vehicle two hops away.
  await page.goto(driverUrl);
  await expect(page.getByRole('link', { name: vehicleCode })).toBeVisible();

  // Logout
  await page.getByRole('button', { name: /^Sair da conta/ }).click();
  await expect(page).toHaveURL(/\/login/);
});
