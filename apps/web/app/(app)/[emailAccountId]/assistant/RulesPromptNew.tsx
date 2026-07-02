"use client";

import { useCallback, useState, useRef } from "react";
import { PlusIcon, UserPenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SimpleRichTextEditor,
  type SimpleRichTextEditorRef,
} from "@/components/editor/SimpleRichTextEditor";
import { LoadingContent } from "@/components/LoadingContent";
import { getPersonas } from "@/app/(app)/[emailAccountId]/assistant/examples";
import { PersonaDialog } from "@/app/(app)/[emailAccountId]/assistant/PersonaDialog";
import { useModal } from "@/hooks/useModal";
import { useAccount } from "@/providers/EmailAccountProvider";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLabels } from "@/hooks/useLabels";
import { RuleDialog } from "@/app/(app)/[emailAccountId]/assistant/RuleDialog";
import { useDialogState } from "@/hooks/useDialogState";
import { useRules } from "@/hooks/useRules";
import { ExamplesGrid } from "@/app/(app)/[emailAccountId]/assistant/ExamplesList";
import { toastError, toastSuccess } from "@/components/Toast";
import { AvailableActionsPanel } from "@/app/(app)/[emailAccountId]/assistant/AvailableActionsPanel";
import { convertMentionsToLabels } from "@/utils/mention";
import { createRulesFromPromptAction } from "@/utils/actions/rule";

export function RulesPrompt({ onSubmitted }: { onSubmitted?: () => void }) {
  const { provider } = useAccount();
  const { isModalOpen, setIsModalOpen } = useModal();
  const onOpenPersonaDialog = useCallback(
    () => setIsModalOpen(true),
    [setIsModalOpen],
  );

  const [persona, setPersona] = useState<string | null>(null);
  const personas = getPersonas(provider);

  const examples = persona
    ? personas[persona as keyof typeof personas]?.promptArray
    : undefined;

  return (
    <>
      <RulesPromptForm
        provider={provider}
        examples={examples}
        onOpenPersonaDialog={onOpenPersonaDialog}
        onHideExamples={() => setPersona(null)}
        onSubmitted={onSubmitted}
      />
      <PersonaDialog
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        onSelect={setPersona}
        personas={personas}
      />
    </>
  );
}

function RulesPromptForm({
  provider,
  examples,
  onOpenPersonaDialog,
  onHideExamples,
  onSubmitted,
}: {
  provider: string;
  examples?: string[];
  onOpenPersonaDialog: () => void;
  onHideExamples: () => void;
  onSubmitted?: () => void;
}) {
  const { emailAccountId } = useAccount();
  const { mutate } = useRules();
  const { userLabels, isLoading: isLoadingLabels } = useLabels();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const ruleDialog = useDialogState();

  const editorRef = useRef<SimpleRichTextEditorRef>(null);

  const onSubmit = useCallback(async () => {
    const markdown = editorRef.current?.getMarkdown();
    if (typeof markdown !== "string") return;
    const prompt = convertMentionsToLabels(markdown).trim();
    if (prompt === "") {
      toastError({
        description: "Please enter a prompt to create rules",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createRulesFromPromptAction(emailAccountId, {
        prompt,
      });

      if (result?.serverError) {
        toastError({ description: result.serverError });
        return;
      }

      const createdCount = result?.data?.createdCount ?? 0;

      if (createdCount === 0) {
        toastError({
          description: "No new rules were created.",
        });
        return;
      }

      toastSuccess({
        description:
          createdCount === 1
            ? "Created 1 rule."
            : `Created ${createdCount} rules.`,
      });
      mutate();
      onSubmitted?.();
    } catch {
      toastError({ description: "Could not create rules from this prompt." });
    } finally {
      setIsSubmitting(false);
    }
  }, [emailAccountId, mutate, onSubmitted]);

  const addExamplePrompt = useCallback((example: string) => {
    editorRef.current?.appendText(`\n* ${example.trim()}`);
  }, []);

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,250px] gap-6">
        <div className="grid gap-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSubmit();
            }}
          >
            <Label className="font-title text-xl leading-7">
              Add new rules
            </Label>

            <div className="mt-1.5 space-y-2">
              <LoadingContent
                loading={isLoadingLabels}
                loadingComponent={<Skeleton className="min-h-[180px] w-full" />}
              >
                <SimpleRichTextEditor
                  ref={editorRef}
                  defaultValue={undefined}
                  minHeight={180}
                  userLabels={userLabels}
                  placeholder={`* Label urgent emails as "Urgent"
* Forward receipts to jane@accounting.com`}
                />
              </LoadingContent>

              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <Button type="submit" size="sm" loading={isSubmitting}>
                  Create rules
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={examples ? onHideExamples : onOpenPersonaDialog}
                >
                  <UserPenIcon className="mr-2 size-4" />
                  {examples ? "Hide examples" : "Choose from examples"}
                </Button>

                <Button
                  type="button"
                  className="ml-auto w-full sm:w-auto"
                  variant="outline"
                  size="sm"
                  onClick={() => ruleDialog.onOpen()}
                  Icon={PlusIcon}
                >
                  Add rule manually
                </Button>
              </div>
            </div>
          </form>
        </div>

        <div className="pr-4">
          <AvailableActionsPanel />
        </div>
      </div>

      {examples && (
        <div className="mt-2">
          <Label className="font-title text-xl leading-7">Examples</Label>
          <div className="mt-1.5">
            <ExamplesGrid
              examples={examples}
              onSelect={addExamplePrompt}
              provider={provider}
            />
          </div>
        </div>
      )}

      <RuleDialog
        isOpen={ruleDialog.isOpen}
        onClose={ruleDialog.onClose}
        onSuccess={() => {
          mutate();
          ruleDialog.onClose();
        }}
        editMode={false}
      />
    </div>
  );
}
