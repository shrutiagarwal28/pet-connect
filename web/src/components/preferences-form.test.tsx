import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreferencesForm } from "./preferences-form";

describe("PreferencesForm", () => {
  it("shows friendly validation errors when submitted empty", async () => {
    render(<PreferencesForm onValidPreferences={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /show my matches/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/check the highlighted answers/i);
    expect(screen.getByText(/valid 5-digit zip/i)).toBeInTheDocument();
    expect(screen.getByText(/choose at least one personality/i)).toBeInTheDocument();
  });

  it("submits a validated AdopterPreferences model", async () => {
    const onValidPreferences = vi.fn();
    render(<PreferencesForm onValidPreferences={onValidPreferences} />);

    await userEvent.type(screen.getByLabelText(/zip code/i), "10001");
    await userEvent.selectOptions(screen.getByLabelText(/maximum travel distance/i), "25");
    const yesNoRadios = screen.getAllByRole("radio");
    fireEvent.click(yesNoRadios[1]);
    fireEvent.click(yesNoRadios[2]);
    fireEvent.click(yesNoRadios[5]);
    await userEvent.selectOptions(screen.getByLabelText(/maximum dog size/i), "medium");
    await userEvent.selectOptions(screen.getByLabelText(/your activity level/i), "moderate");
    await userEvent.type(screen.getByLabelText(/hours away/i), "6");
    await userEvent.selectOptions(screen.getByLabelText(/dog-owning experience/i), "some");
    await userEvent.click(screen.getByRole("checkbox", { name: /affectionate/i }));
    await userEvent.click(screen.getByRole("button", { name: /show my matches/i }));

    expect(onValidPreferences).toHaveBeenCalledWith(expect.objectContaining({
      zipCode: "10001",
      maxTravelDistanceMiles: 25,
      hasChildren: false,
      hasExistingDogs: true,
      hasExistingCats: false,
      personalityPreferences: ["affectionate"],
    }));
  });
});
