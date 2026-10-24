# Painel de Clientes

Painel web para acompanhar leads: visão geral com indicadores e gráficos, ficha de cada cliente (troca de produto, etapa, corretor e feedbacks) e controle de acesso por pessoa.

- **Hospedagem:** GitHub Pages (só o código fica aqui).
- **Dados e login:** Firebase (Google Auth + Firestore). Nenhum dado de cliente fica neste repositório.
- **Administrador:** 1imovjund@gmail.com. Outras pessoas entram só depois de liberadas na aba **Acessos**.

## Papéis

| Papel | Vê | Pode alterar |
|---|---|---|
| Administrador | Todos os clientes | Tudo: produto, etapa, corretor, designação, acessos, importação |
| Gestor | Clientes dos corretores escolhidos pelo administrador e os designados a ele | Produto, etapa, motivo do descarte e feedbacks |
| Corretor | Só os clientes designados a ele | Produto, etapa, motivo do descarte e feedbacks |

As permissões são garantidas no servidor pelas regras em `firestore.rules`, não só pela interface.

## Atualizar a base

Exporte o relatório do CRM em .xlsx e envie na aba **Importar**. Clientes são identificados pelo telefone: novos são criados e os existentes são atualizados, sem perder feedbacks nem designações.

## Arquivos

- `index.html` — interface e estilos (tokens de design no `:root`)
- `app.js` — lógica (login, dashboard, clientes, acessos, importação)
- `config.js` — configuração pública do projeto Firebase
- `firestore.rules` — regras de segurança (publicar no console do Firebase)
