import { App, Modal, Setting } from "obsidian";
import { t } from "./i18n";

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

class ConfirmationModal extends Modal {
  private confirmed = false;

  constructor(app: App, private readonly options: ConfirmationOptions, private readonly resolve: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });
    new Setting(this.contentEl)
      .addButton(button => {
        button.setButtonText(t("Cancel", "取消")).onClick(() => this.close());
        button.buttonEl.focus();
      })
      .addButton(button => {
        button.setButtonText(this.options.confirmLabel ?? t("Continue", "继续"));
        if (this.options.destructive) button.setDestructive();
        else button.setCta();
        button.onClick(() => {
          this.confirmed = true;
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.confirmed);
  }
}

export function confirmAction(app: App, options: ConfirmationOptions): Promise<boolean> {
  return new Promise(resolve => new ConfirmationModal(app, options, resolve).open());
}
