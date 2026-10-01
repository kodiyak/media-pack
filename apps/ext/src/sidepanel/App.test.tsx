import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("<App />", () => {
  it("renderiza o título do popup", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /media pack/i })).toBeInTheDocument();
  });

  it("cria um pack a partir do nome informado", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/nome do pack/i), "Referências");
    await user.click(screen.getByRole("button", { name: /criar pack/i }));

    expect(screen.getByText("Referências")).toBeInTheDocument();
    expect(screen.getByText(/packs \(1\)/i)).toBeInTheDocument();
  });

  it("mostra erro ao tentar criar sem nome", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /criar pack/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
