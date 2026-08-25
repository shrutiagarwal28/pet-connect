import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("keeps matching as the only product action", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Find your best friend." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find your dog" })).toHaveAttribute("href", "/preferences");
    expect(screen.queryByRole("link", { name: /browse/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A thoughtful match, from the start." })).toBeInTheDocument();
  });
});
