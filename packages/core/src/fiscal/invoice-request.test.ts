// covers FR-058, FR-120, FR-122, FR-123, FR-124, FR-125, ADR-013, ADR-016
import { describe, expect, test } from "bun:test";
import {
  buildInvoiceRequest,
  type FiscalConfig,
  type InvoiceCustomer,
  type InvoiceMenuItem,
  type InvoiceOrder,
  type InvoiceOrderItem,
  type InvoiceProblem,
  missingFields,
  precheckInvoice,
} from "./invoice-request";

const MEAL_ID = "11111111-2222-3333-4444-555555555555";
const DRINK_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const config: FiscalConfig = {
  baseUrl: "https://nf.example.com",
  apiKeyConfigured: true,
  nfceSerie: 1,
  nfeSerie: 2,
  defaultNcm: "21069090",
  defaultCfop: "5101",
  defaultCsosn: "102",
  defaultPisCst: "49",
  defaultCofinsCst: "49",
  deliveryFeeMode: "item",
};
const menu: InvoiceMenuItem[] = [
  { id: MEAL_ID, kind: "meal", ncm: null, cfop: null },
  { id: DRINK_ID, kind: "drink", ncm: null, cfop: null },
];
const address = {
  cep: "01310100",
  logradouro: "Rua das Flores",
  numero: "120",
  complemento: null,
  bairro: "Centro",
  cidade: "São Paulo",
  uf: "SP",
  codigoMunicipio: "3550308",
};
const customer: InvoiceCustomer = { name: "Ana Souza", cpfCnpj: "11144477735", ...address };
const meal: InvoiceOrderItem = {
  menuItemId: MEAL_ID,
  name: "Marmita de frango",
  sizeName: "Grande",
  unitPriceCents: 3900,
  qty: 2,
};
const pickupOrder: InvoiceOrder = {
  code: "ORD-042",
  status: "entregue",
  fulfillment: "pickup",
  paymentMethod: "pix",
  changeForCents: null,
  deliveryFeeCents: 0,
  totalCents: 7800,
  ...address,
};
const deliveryOrder: InvoiceOrder = {
  ...pickupOrder,
  fulfillment: "delivery",
  deliveryFeeCents: 600,
  totalCents: 8400,
};

function ok(result: ReturnType<typeof buildInvoiceRequest>) {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.problems)}`);
  return result.request;
}
function problems(result: ReturnType<typeof buildInvoiceRequest>): readonly InvoiceProblem[] {
  if (result.ok) throw new Error("expected problems");
  return result.problems;
}
const paths = (p: readonly InvoiceProblem[]) => p.map((x) => x.path);

describe("NFC-e mapping", () => {
  test("pickup meal, no buyer: presencial, one item, pix payment", () => {
    const req = ok(buildInvoiceRequest(pickupOrder, [meal], customer, config, menu, "nfce"));
    expect(req).toEqual({
      kind: "nfce",
      reference: "ORD-042",
      nfce: {
        serie: 1,
        operacao: { natureza: "Venda ao consumidor", presenca: "presencial" },
        itens: [
          {
            codigo: "11111111",
            descricao: "Marmita de frango (Grande)",
            ncm: "21069090",
            cfop: "5101",
            unidade: "UN",
            quantidade: 2,
            valor_unitario: 39,
            impostos: { icms: { origem: "0", csosn: "102" }, pis: { cst: "49" }, cofins: { cst: "49" } },
          },
        ],
        pagamentos: [{ forma: "pix", valor: 78 }],
        informacoes_adicionais: "Pedido ORD-042",
      },
    });
  });

  test("reference is the order_invoices.id when given, the order code otherwise", () => {
    const id = "9b2f6f0e-1111-4222-8333-444455556666";
    const withId = ok(buildInvoiceRequest(pickupOrder, [meal], customer, config, menu, "nfce", { reference: id }));
    expect(withId.reference).toBe(id);
    expect((withId as any).nfce.informacoes_adicionais).toBe("Pedido ORD-042");
    expect(ok(buildInvoiceRequest(pickupOrder, [meal], customer, config, menu, "nfce")).reference).toBe("ORD-042");
  });

  test("the NFC-e body never carries fields the kind fixes", () => {
    const req = ok(buildInvoiceRequest(pickupOrder, [meal], customer, config, menu, "nfce"));
    const nfce = (req as { nfce: Record<string, unknown> }).nfce;
    for (const banned of ["tipo", "finalidade", "consumidor_final", "indicador_ie", "frete"]) {
      expect(banned in nfce).toBe(false);
      expect(banned in (nfce.operacao as object)).toBe(false);
    }
  });

  test('pickup with "CPF na nota" sends the buyer with name and CPF only', () => {
    const req = ok(buildInvoiceRequest(pickupOrder, [meal], customer, config, menu, "nfce", { identifyBuyer: true }));
    expect((req as any).nfce.destinatario).toEqual({ cpf: "11144477735", nome: "Ana Souza" });
  });

  test("delivery meal with fee: entrega_domicilio, buyer with address, fee as an extra item", () => {
    const req = ok(buildInvoiceRequest(deliveryOrder, [meal], customer, config, menu, "nfce")) as any;
    expect(req.nfce.operacao.presenca).toBe("entrega_domicilio");
    expect(req.nfce.destinatario).toEqual({
      cpf: "11144477735",
      nome: "Ana Souza",
      endereco: {
        logradouro: "Rua das Flores",
        numero: "120",
        bairro: "Centro",
        codigo_municipio: "3550308",
        municipio: "São Paulo",
        uf: "SP",
        cep: "01310100",
      },
    });
    expect(req.nfce.itens.length).toBe(2);
    expect(req.nfce.itens[1]).toEqual({
      codigo: "ENTREGA",
      descricao: "Taxa de entrega",
      ncm: "21069090",
      cfop: "5101",
      unidade: "UN",
      quantidade: 1,
      valor_unitario: 6,
      impostos: { icms: { origem: "0", csosn: "102" }, pis: { cst: "49" }, cofins: { cst: "49" } },
    });
    expect(req.nfce.pagamentos).toEqual([{ forma: "pix", valor: 84 }]);
  });

  test("complemento goes into the address when present", () => {
    const c = { ...customer, complemento: "Apto 12" };
    const o = { ...deliveryOrder, complemento: "Bloco B" };
    const req = ok(buildInvoiceRequest(o, [meal], c, config, menu, "nfce")) as any;
    expect(req.nfce.destinatario.endereco.complemento).toBe("Bloco B");
  });

  test("the order address wins; gaps fall back to the customer address", () => {
    const o = { ...deliveryOrder, logradouro: "Rua Nova", numero: null, cep: null };
    const req = ok(buildInvoiceRequest(o, [meal], customer, config, menu, "nfce")) as any;
    expect(req.nfce.destinatario.endereco.logradouro).toBe("Rua Nova");
    expect(req.nfce.destinatario.endereco.numero).toBe("120");
    expect(req.nfce.destinatario.endereco.cep).toBe("01310100");
  });

  test('delivery fee mode "none" with a fee blocks issuing', () => {
    const r = buildInvoiceRequest(
      deliveryOrder,
      [meal],
      customer,
      { ...config, deliveryFeeMode: "none" },
      menu,
      "nfce",
    );
    expect(problems(r).map((p) => p.code)).toContain("delivery_fee_not_invoiceable");
  });

  test('delivery fee mode "none" with a zero fee is fine', () => {
    const o = { ...deliveryOrder, deliveryFeeCents: 0, totalCents: 7800 };
    const req = ok(
      buildInvoiceRequest(o, [meal], customer, { ...config, deliveryFeeMode: "none" }, menu, "nfce"),
    ) as any;
    expect(req.nfce.itens.length).toBe(1);
  });

  test("cash without change: valor = total, no troco", () => {
    const o = { ...pickupOrder, paymentMethod: "dinheiro" as const };
    const req = ok(buildInvoiceRequest(o, [meal], customer, config, menu, "nfce")) as any;
    expect(req.nfce.pagamentos).toEqual([{ forma: "dinheiro", valor: 78 }]);
    expect("troco" in req.nfce).toBe(false);
  });

  test("cash with change: valor = amount handed over, troco = difference", () => {
    const o = { ...deliveryOrder, paymentMethod: "dinheiro" as const, changeForCents: 10000 };
    const req = ok(buildInvoiceRequest(o, [meal], customer, config, menu, "nfce")) as any;
    expect(req.nfce.pagamentos).toEqual([{ forma: "dinheiro", valor: 100 }]);
    expect(req.nfce.troco).toBe(16);
  });

  test("change equal to the total is treated as no change", () => {
    const o = { ...pickupOrder, paymentMethod: "dinheiro" as const, changeForCents: 7800 };
    const req = ok(buildInvoiceRequest(o, [meal], customer, config, menu, "nfce")) as any;
    expect(req.nfce.pagamentos).toEqual([{ forma: "dinheiro", valor: 78 }]);
    expect("troco" in req.nfce).toBe(false);
  });

  test("card payments map one to one", () => {
    for (const forma of ["cartao_credito", "cartao_debito"] as const) {
      const req = ok(
        buildInvoiceRequest({ ...pickupOrder, paymentMethod: forma }, [meal], customer, config, menu, "nfce"),
      ) as any;
      expect(req.nfce.pagamentos).toEqual([{ forma, valor: 78 }]);
    }
  });

  test("mixed meal and drink with CFOP 5405 on the drink: that item gets CSOSN 500", () => {
    const drink: InvoiceOrderItem = { menuItemId: DRINK_ID, name: "Suco", sizeName: null, unitPriceCents: 799, qty: 3 };
    const menu2 = [menu[0] as InvoiceMenuItem, { id: DRINK_ID, kind: "drink" as const, ncm: "20098900", cfop: "5405" }];
    const o = { ...pickupOrder, totalCents: 7800 + 2397 };
    const req = ok(buildInvoiceRequest(o, [meal, drink], customer, config, menu2, "nfce")) as any;
    expect(req.nfce.itens[0].impostos.icms.csosn).toBe("102");
    expect(req.nfce.itens[1]).toMatchObject({
      codigo: "aaaaaaaa",
      descricao: "Suco",
      ncm: "20098900",
      cfop: "5405",
      quantidade: 3,
      valor_unitario: 7.99,
      impostos: { icms: { origem: "0", csosn: "500" } },
    });
  });

  test("menu item overrides beat the restaurant defaults (FR-058)", () => {
    const menu2 = [{ id: MEAL_ID, kind: "meal" as const, ncm: "19059090", cfop: "5102" }];
    const req = ok(buildInvoiceRequest(pickupOrder, [meal], customer, config, menu2, "nfce")) as any;
    expect(req.nfce.itens[0]).toMatchObject({ ncm: "19059090", cfop: "5102" });
  });

  test("an item deleted from the menu falls back to the defaults and warns", () => {
    const r = buildInvoiceRequest(pickupOrder, [meal], customer, config, [], "nfce");
    const req = ok(r) as any;
    expect(req.nfce.itens[0]).toMatchObject({ ncm: "21069090", cfop: "5101" });
    if (r.ok) expect(r.warnings.length).toBe(1);
  });

  test("an item with no menu id gets a stable code derived from its name", () => {
    const orphan = { ...meal, menuItemId: null };
    const a = ok(buildInvoiceRequest(pickupOrder, [orphan], customer, config, [], "nfce")) as any;
    const b = ok(buildInvoiceRequest(pickupOrder, [orphan], customer, config, [], "nfce")) as any;
    expect(a.nfce.itens[0].codigo).toMatch(/^[0-9a-f]{8}$/);
    expect(a.nfce.itens[0].codigo).toBe(b.nfce.itens[0].codigo);
  });

  test("descricao is truncated to 120 characters, never failing", () => {
    const long = { ...meal, name: "M".repeat(200) };
    const req = ok(buildInvoiceRequest(pickupOrder, [long], customer, config, menu, "nfce")) as any;
    expect(req.nfce.itens[0].descricao.length).toBe(120);
  });

  test("omits the size part when there is none", () => {
    const req = ok(
      buildInvoiceRequest(pickupOrder, [{ ...meal, sizeName: null }], customer, config, menu, "nfce"),
    ) as any;
    expect(req.nfce.itens[0].descricao).toBe("Marmita de frango");
  });

  test("CSOSN comes from the restaurant default", () => {
    const req = ok(
      buildInvoiceRequest(pickupOrder, [meal], customer, { ...config, defaultCsosn: "101" }, menu, "nfce"),
    ) as any;
    expect(req.nfce.itens[0].impostos.icms.csosn).toBe("101");
  });

  test("sum of item lines equals the order total for many quantities and prices (property)", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const items: InvoiceOrderItem[] = Array.from({ length: 1 + rnd(4) }, (_, k) => ({
        menuItemId: MEAL_ID,
        name: `Item ${k}`,
        sizeName: null,
        unitPriceCents: 1 + rnd(20000),
        qty: 1 + rnd(99),
      }));
      const fee = rnd(2) === 0 ? 0 : rnd(1500);
      const subtotal = items.reduce((s, it) => s + it.unitPriceCents * it.qty, 0);
      const order: InvoiceOrder = { ...deliveryOrder, deliveryFeeCents: fee, totalCents: subtotal + fee };
      const buyer: InvoiceCustomer = { ...customer, cpfCnpj: "11144477735" };
      const req = ok(buildInvoiceRequest(order, items, buyer, config, menu, "nfce")) as any;
      const sumCents = req.nfce.itens.reduce(
        (s: number, it: { quantidade: number; valor_unitario: number }) =>
          s + Math.round(it.quantidade * Math.round(it.valor_unitario * 100)),
        0,
      );
      expect(sumCents).toBe(order.totalCents);
      const pay = req.nfce.pagamentos[0].valor;
      expect(Math.round(pay * 100)).toBe(order.totalCents);
    }
  });
});

describe("NFe mapping", () => {
  const company: InvoiceCustomer = { ...customer, name: "Padaria Boa Ltda", cpfCnpj: "11222333000181" };

  test("delivery to a company: full NFe body", () => {
    const req = ok(buildInvoiceRequest(deliveryOrder, [meal], company, config, menu, "nfe")) as any;
    expect(req.kind).toBe("nfe");
    expect(req.reference).toBe("ORD-042");
    expect(req.nfe.serie).toBe(2);
    expect(req.nfe.operacao).toEqual({
      natureza: "Venda de mercadoria",
      tipo: "saida",
      finalidade: "normal",
      consumidor_final: true,
      presenca: "entrega_domicilio",
    });
    expect(req.nfe.destinatario).toEqual({
      cnpj: "11222333000181",
      nome: "Padaria Boa Ltda",
      endereco: {
        logradouro: "Rua das Flores",
        numero: "120",
        bairro: "Centro",
        codigo_municipio: "3550308",
        municipio: "São Paulo",
        uf: "SP",
        cep: "01310100",
      },
      indicador_ie: "nao_contribuinte",
    });
    expect(req.nfe.frete).toEqual({ modalidade: "proprio_remetente" });
    expect(req.nfe.itens.length).toBe(2);
    expect(req.nfe.pagamentos).toEqual([{ forma: "pix", valor: 84 }]);
    expect(req.nfe.informacoes_adicionais).toBe("Pedido ORD-042");
    expect("troco" in req.nfe).toBe(false);
  });

  test("pickup: presencial and sem_frete", () => {
    const req = ok(buildInvoiceRequest(pickupOrder, [meal], company, config, menu, "nfe")) as any;
    expect(req.nfe.operacao.presenca).toBe("presencial");
    expect(req.nfe.frete).toEqual({ modalidade: "sem_frete" });
  });

  test("cash with change: the NFe payment is the total (the body has no troco field)", () => {
    const o = { ...deliveryOrder, paymentMethod: "dinheiro" as const, changeForCents: 10000 };
    const req = ok(buildInvoiceRequest(o, [meal], company, config, menu, "nfe")) as any;
    expect(req.nfe.pagamentos).toEqual([{ forma: "dinheiro", valor: 84 }]);
  });

  test("an NFe request without a CNPJ is rejected before sending (FR-122)", () => {
    const r = buildInvoiceRequest(pickupOrder, [meal], customer, config, menu, "nfe");
    expect(problems(r).find((p) => p.path === "customer.cpf_cnpj")?.message).toBe(
      "NF-e exige CNPJ, razão social e endereço completo.",
    );
  });

  test("an NFe without a full address lists each missing field", () => {
    const c = { ...company, cep: null, numero: null };
    const r = buildInvoiceRequest(pickupOrder, [meal], c, config, menu, "nfe");
    // order has the address, so the fallback fills it; blank the order too
    expect(r.ok).toBe(true);
    const r2 = buildInvoiceRequest({ ...pickupOrder, cep: null, numero: null }, [meal], c, config, menu, "nfe");
    expect(paths(problems(r2))).toEqual(expect.arrayContaining(["address.cep", "address.numero"]));
  });
});

describe("pre-send rules V1..V14 (each failing and passing)", () => {
  const run = (over: {
    order?: Partial<InvoiceOrder>;
    items?: InvoiceOrderItem[];
    customer?: Partial<InvoiceCustomer>;
    config?: Partial<FiscalConfig>;
    menu?: InvoiceMenuItem[];
    kind?: "nfce" | "nfe";
    options?: { hasActiveInvoice?: boolean; identifyBuyer?: boolean };
  }) =>
    precheckInvoice(
      { ...pickupOrder, ...over.order },
      over.items ?? [meal],
      { ...customer, ...over.customer },
      { ...config, ...over.config },
      over.menu ?? menu,
      over.kind ?? "nfce",
      over.options,
    );

  test("a clean order passes every rule", () => {
    expect(run({})).toEqual([]);
    expect(run({ order: deliveryOrder })).toEqual([]);
  });

  test("V1 integration missing", () => {
    expect(run({ config: { baseUrl: null } })[0]).toMatchObject({
      path: "integrations_fiscal",
      code: "fiscal_not_configured",
    });
    expect(run({ config: { apiKeyConfigured: false } })[0]).toMatchObject({ code: "fiscal_not_configured" });
    expect(run({ config: { baseUrl: null } })[0]?.message).toBe("Configure a integração fiscal em Configurações.");
  });

  test("V2 series for the chosen kind", () => {
    expect(run({ config: { nfceSerie: null } })[0]).toMatchObject({ path: "integrations_fiscal.nfce_serie" });
    expect(run({ config: { nfceSerie: null } })[0]?.message).toBe(
      "Informe a série da NFC-e em Configurações → Fiscal.",
    );
    // a missing NFe series does not matter for an NFC-e
    expect(run({ config: { nfeSerie: null } })).toEqual([]);
    expect(
      run({ config: { nfeSerie: null }, kind: "nfe", customer: { cpfCnpj: "11222333000181" } }).map((p) => p.path),
    ).toContain("integrations_fiscal.nfe_serie");
  });

  test("V3 NCM and CFOP after resolution", () => {
    const p = run({
      config: { defaultNcm: null },
      items: [{ menuItemId: DRINK_ID, name: "Suco", sizeName: null, unitPriceCents: 7800, qty: 1 }],
    });
    expect(p).toContainEqual({
      path: "items[0].ncm",
      code: "required",
      message: "O item «Suco» está sem NCM. Preencha no cardápio.",
    });
    expect(run({ menu: [{ id: MEAL_ID, kind: "meal", ncm: null, cfop: "51" }] }).map((x) => x.path)).toContain(
      "items[0].cfop",
    );
    // a meal falls back to the built-in CFOP 5101 when the default is missing
    expect(run({ config: { defaultCfop: null } })).toEqual([]);
    expect(run({ menu: [{ id: MEAL_ID, kind: "meal", ncm: "123", cfop: null }] }).map((x) => x.path)).toContain(
      "items[0].ncm",
    );
    // a drink has no built-in NCM
    expect(
      run({
        config: { defaultNcm: null },
        items: [{ menuItemId: DRINK_ID, name: "Suco", sizeName: null, unitPriceCents: 7800, qty: 1 }],
      }).map((x) => x.path),
    ).toContain("items[0].ncm");
    // a meal falls back to the built-in 21069090
    expect(run({ config: { defaultNcm: null } }).map((x) => x.path)).not.toContain("items[0].ncm");
  });

  test("V4 CSOSN and PIS/COFINS CST", () => {
    expect(run({ config: { defaultCsosn: null } })[0]).toMatchObject({ path: "integrations_fiscal.default_csosn" });
    expect(run({ config: { defaultCsosn: null } })[0]?.message).toBe(
      "Defina os códigos de impostos padrão em Configurações → Fiscal.",
    );
    expect(run({ config: { defaultPisCst: "9" } }).map((p) => p.path)).toContain("integrations_fiscal.default_pis_cst");
    expect(run({ config: { defaultCofinsCst: "" } }).map((p) => p.path)).toContain(
      "integrations_fiscal.default_cofins_cst",
    );
    // CFOP 5405 needs no default CSOSN
    expect(
      run({ config: { defaultCsosn: null }, menu: [{ id: MEAL_ID, kind: "meal", ncm: null, cfop: "5405" }] }),
    ).toEqual([]);
  });

  test("V5 delivery needs CPF/CNPJ and the full address, one problem per missing field", () => {
    const p = run({
      order: { ...deliveryOrder, cep: null, numero: null, bairro: null, uf: null, codigoMunicipio: null, cidade: null },
      customer: { cpfCnpj: null, cep: null, numero: null, bairro: null, uf: null, codigoMunicipio: null, cidade: null },
    });
    expect(paths(p).sort()).toEqual(
      [
        "address.bairro",
        "address.cep",
        "address.cidade",
        "address.codigo_municipio",
        "address.numero",
        "address.uf",
        "customer.cpf_cnpj",
      ].sort(),
    );
    expect(p.every((x) => x.message === "Para entrega, informe CPF/CNPJ e o endereço completo do cliente.")).toBe(true);
    expect(missingFields(p).sort()).toEqual(paths(p).sort());
  });

  test("V5 does not apply to pickup", () => {
    expect(run({ customer: { cpfCnpj: null, cep: null, numero: null } })).toEqual([]);
  });

  test("V6 totals of R$ 10.000,00 or more need CPF/CNPJ even for pickup", () => {
    const big = { unitPriceCents: 1_000_000, qty: 1 };
    const p = run({
      order: { totalCents: 1_000_000 },
      items: [{ ...meal, ...big }],
      customer: { cpfCnpj: null },
    });
    expect(p).toEqual([
      {
        path: "customer.cpf_cnpj",
        code: "required",
        message: "Pedidos acima de R$ 10.000,00 exigem CPF ou CNPJ do cliente.",
      },
    ]);
    const under = run({
      order: { totalCents: 999_999 },
      items: [{ ...meal, unitPriceCents: 999_999, qty: 1 }],
      customer: { cpfCnpj: null },
    });
    expect(under).toEqual([]);
    const withCpf = buildInvoiceRequest(
      { ...pickupOrder, totalCents: 1_000_000 },
      [{ ...meal, ...big }],
      customer,
      config,
      menu,
      "nfce",
    );
    expect((ok(withCpf) as any).nfce.destinatario.cpf).toBe("11144477735");
  });

  test("V7 CPF/CNPJ must be valid when present", () => {
    expect(run({ customer: { cpfCnpj: "11144477736" } })).toEqual([
      { path: "customer.cpf_cnpj", code: "invalid", message: "CPF/CNPJ inválido." },
    ]);
    expect(run({ customer: { cpfCnpj: "111.444.777-35" } })).toEqual([]); // punctuation is stripped
  });

  test("V8 the item lines must add up to the order total", () => {
    expect(run({ order: { totalCents: 7801 } })).toEqual([
      {
        path: "order.total_cents",
        code: "total_mismatch",
        message: "O total do pedido não confere com os itens. Revise o pedido.",
      },
    ]);
  });

  test("V9 change must be at least the total", () => {
    expect(run({ order: { paymentMethod: "dinheiro", changeForCents: 7000 } })).toEqual([
      { path: "order.change_for_cents", code: "invalid", message: "O valor para troco é menor que o total." },
    ]);
    expect(run({ order: { paymentMethod: "dinheiro", changeForCents: 8000 } })).toEqual([]);
  });

  test("V10 NFe needs a CNPJ, a name, and a full address", () => {
    expect(run({ kind: "nfe" }).map((p) => p.path)).toContain("customer.cpf_cnpj");
    const company = { cpfCnpj: "11222333000181" };
    expect(run({ kind: "nfe", customer: company })).toEqual([]);
    expect(run({ kind: "nfe", customer: { ...company, name: "" } }).map((p) => p.path)).toContain("customer.name");
  });

  test("V11 only pronto, saiu, and entregue orders can be invoiced", () => {
    for (const status of ["pronto", "saiu", "entregue"] as const) {
      expect(
        run({
          order: {
            status,
            fulfillment: status === "saiu" ? "delivery" : "pickup",
            ...(status === "saiu" ? { deliveryFeeCents: 0, totalCents: 7800 } : {}),
          },
        }),
      ).toEqual([]);
    }
    for (const status of ["aguardando", "confirmado", "preparando", "cancelado"] as const) {
      expect(run({ order: { status } })).toEqual([
        {
          path: "order.status",
          code: "invoice_not_allowed",
          message: "Só é possível emitir nota de pedidos prontos, em entrega ou entregues.",
        },
      ]);
    }
  });

  test("V12 no second active invoice", () => {
    expect(run({ options: { hasActiveInvoice: true } })).toEqual([
      {
        path: "order",
        code: "invoice_already_active",
        message: "Este pedido já tem uma nota em andamento ou emitida.",
      },
    ]);
  });

  test("V13 quantity and price must be valid", () => {
    expect(run({ items: [{ ...meal, qty: 0 }], order: { totalCents: 0 } }).map((p) => p.path)).toContain(
      "items[0].qty",
    );
    expect(run({ items: [{ ...meal, unitPriceCents: -1 }] }).map((p) => p.code)).toContain("invalid_item");
    expect(run({ items: [{ ...meal, qty: 1.5 }] }).map((p) => p.path)).toContain("items[0].qty");
    expect(run({ items: [{ ...meal, qty: 0 }], order: { totalCents: 0 } })[0]?.message).toBe(
      "Item com quantidade ou preço inválido.",
    );
  });

  test("V14 a zero total has nothing to invoice", () => {
    const p = run({ items: [{ ...meal, unitPriceCents: 0 }], order: { totalCents: 0 } });
    expect(p).toContainEqual({
      path: "order.total_cents",
      code: "zero_total",
      message: "O pedido tem total zero. Não há nota a emitir.",
    });
  });

  test("buildInvoiceRequest returns the same problems and never a partial request", () => {
    const r = buildInvoiceRequest({ ...pickupOrder, status: "aguardando" }, [meal], customer, config, menu, "nfce");
    expect(r.ok).toBe(false);
    expect("request" in r).toBe(false);
  });
});
