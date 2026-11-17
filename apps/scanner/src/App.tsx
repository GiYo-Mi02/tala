import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  type ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import {
  beefTemplate,
  fieldKeys,
  fieldLabels,
  newDraft,
  parsePrintedDate,
  printedDate,
  readinessProblems,
  validateValues,
  isAligned,
  readingRegions,
  type Draft,
  type FieldKey,
  type Page,
  type Region,
  type PageNumber,
} from "@tala/core";
import { Capture, Crop, type Candidate } from "./Capture";
import {
  initializeRepository,
  listDrafts,
  missingPages,
  persistDraft,
  persistPage,
  discardCache,
} from "./repository";
import { recognizePage } from "./ocr";
import { Action, Card, colors, styles } from "./ui";
import { ReadingImage, ReadingStrip } from "./ReadingImage";

type Route =
  | { name: "home" | "editor" }
  | { name: "capture"; page: PageNumber }
  | { name: "crop"; page: PageNumber; photo: Candidate; savedPhoto?: boolean };
const references: Record<PageNumber, ImageSourcePropType> = {
  1: require("../assets/beef-page-1.png"),
  2: require("../assets/beef-page-2.png"),
};
const userMessage = (e: unknown) =>
  e instanceof Error &&
  /image|draft|storage|page|field|OCR|photo/i.test(e.message)
    ? e.message
    : "Could not save to private storage. Your changes are still on screen. Free storage and retry.";

function Scanner() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [integrity, setIntegrity] = useState<Record<string, number[]>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [viewer, setViewer] = useState<{
    reference: boolean;
    page: PageNumber;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [areaField, setAreaField] = useState<FieldKey | null>(null);

  const refresh = useCallback(async () => {
    const saved = await listDrafts();
    const missing = await Promise.all(
      saved.map(async (d) => [d.id, await missingPages(d)] as const),
    );
    setDrafts(saved);
    setIntegrity(Object.fromEntries(missing));
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        await initializeRepository();
        await refresh();
      } catch {
        setError(
          "Private draft storage could not open. Restart the app. Do not clear app data if drafts are needed.",
        );
      } finally {
        setLoading(false);
      }
    })();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void refresh().catch(() =>
          setError("Could not check saved drafts. Reopen the app."),
        );
    });
    return () => subscription.remove();
  }, [refresh]);

  function remember(saved: Draft) {
    setDraft(saved);
    setDirty(false);
    setDrafts((previous) =>
      [saved, ...previous.filter((d) => d.id !== saved.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
    setIntegrity((previous) => ({ ...previous, [saved.id]: [] }));
  }
  async function save(next: Draft, message: string) {
    const saved = await persistDraft(next);
    remember(saved);
    setNotice(message);
    setError("");
    return saved;
  }
  async function leave() {
    if (busy) return;
    if (route.name === "crop") {
      await discardCache(route.photo.uri);
      setRoute({ name: "editor" });
      return;
    }
    if (route.name === "capture") {
      setRoute({ name: "editor" });
      return;
    }
    if (route.name === "editor" && draft && dirty) {
      setBusy(true);
      try {
        await save(draft, "Draft saved on this phone.");
        setRoute({ name: "home" });
      } catch (e) {
        setError(userMessage(e));
        Alert.alert(
          "Draft was not saved",
          "Your edits are still on screen. Retake any missing image, free storage, and save again. You can also discard only your unsaved edits.",
          [
            { text: "Keep editing", style: "cancel" },
            {
              text: "Discard unsaved edits",
              style: "destructive",
              onPress: () => {
                setDirty(false);
                setRoute({ name: "home" });
              },
            },
          ],
        );
      } finally {
        setBusy(false);
      }
    } else setRoute({ name: "home" });
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (viewer) {
          setViewer(null);
          return true;
        }
        if (route.name === "home") return false;
        void leave();
        return true;
      },
    );
    return () => subscription.remove();
  });

  async function create() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      remember(
        await persistDraft(
          newDraft(Crypto.randomUUID(), new Date().toISOString()),
        ),
      );
      setRoute({ name: "editor" });
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(key: FieldKey, value: string) {
    if (!draft) return;
    const normalized = key === "birth_date" ? parsePrintedDate(value) : value;
    setDraft({
      ...draft,
      values: { ...draft.values, [key]: normalized },
      confirmed: { ...draft.confirmed, [key]: false },
      state: "editing",
    });
    setDirty(true);
    setNotice("");
  }
  async function runOcr() {
    if (!draft?.pages[1] || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await recognizePage(draft.pages[1], setProgress);
      const next: Draft = {
        ...draft,
        values: result.values,
        ocrHistory: [...draft.ocrHistory, result.run],
        confirmed: {},
        state: "editing",
      };
      setDraft(next);
      setDirty(true);
      await save(
        next,
        "OCR saved. Compare every field with the page, correct it, and confirm it.",
      );
    } catch (e) {
      const message = userMessage(e);
      setError(message);
      Alert.alert("OCR did not finish saving", message);
    } finally {
      setProgress("");
      setBusy(false);
    }
  }
  async function saveButton(ready: boolean) {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await save(
        { ...draft, state: ready ? "ready" : "editing" },
        ready
          ? "Ready for future sync. Saved locally; nothing has been uploaded."
          : "Unfinished draft saved on this phone.",
      );
    } catch (e) {
      const message = userMessage(e);
      setError(message);
      Alert.alert("Draft was not saved", message);
    } finally {
      setBusy(false);
    }
  }
  const problems = draft ? readinessProblems(draft) : [];
  const errors = draft ? validateValues(draft.values) : {};
  const missing = draft ? (integrity[draft.id] ?? []) : [];
  const readyCount = drafts.filter(
    (d) => d.state === "ready" && !integrity[d.id]?.length,
  ).length;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>T.A.L.A.</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>ON THIS PHONE</Text>
        </View>
      </View>
      {loading ? (
        <View style={styles.content}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.body}>Opening private drafts...</Text>
        </View>
      ) : route.name === "capture" ? (
        <Capture
          page={route.page}
          onCancel={() => setRoute({ name: "editor" })}
          onPhoto={async (photo) => {
            if (!draft) throw new Error("No draft is open. Return to the editor and try again.");
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const saved = await persistPage(draft, {
                ...photo,
                page: route.page,
                acceptedAt: new Date().toISOString(),
                imageId: Crypto.randomUUID(),
              });
              remember(saved);
              setRoute({ name: "editor" });
              setNotice(`Page ${route.page} accepted and saved in private storage.`);
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : route.name === "crop" && draft ? (
        <Crop
          photo={route.photo}
          page={route.page}
          busy={busy}
          savedPhoto={route.savedPhoto}
          onWorkingChange={setBusy}
          onCancel={() => setRoute(route.savedPhoto ? { name: "editor" } : { name: "capture", page: route.page })}
          onAccept={async (photo) => {
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const saved = await persistPage(draft, {
                ...photo,
                page: route.page,
                acceptedAt: new Date().toISOString(),
                imageId: Crypto.randomUUID(),
              });
              remember(saved);
              setRoute({ name: "editor" });
              setNotice(
                `Page ${route.page} accepted and saved in private storage.`,
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {!!error && (
            <Card>
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            </Card>
          )}
          {!!notice && (
            <Text
              accessibilityLiveRegion="polite"
              style={{ ...styles.body, color: colors.teal }}
            >
              {notice}
            </Text>
          )}
          {route.name === "home" ? (
            <>
              <Text style={styles.eyebrow}>
                TEXT ACQUISITION & LOCAL AUTOMATION
              </Text>
              <Text style={styles.title}>
                Paper today.{"\n"}Ready for review.
              </Text>
              <Text style={styles.body}>
                Capture two pages, read typed fields, and keep your work safely
                on this phone. Capture and OCR work without a connection.
              </Text>
              <View
                style={{ ...styles.row, justifyContent: "flex-start", gap: 24 }}
              >
                <View>
                  <Text style={styles.title}>{drafts.length}</Text>
                  <Text style={styles.small}>Local drafts</Text>
                </View>
                <View>
                  <Text style={{ ...styles.title, color: colors.teal }}>
                    {readyCount}
                  </Text>
                  <Text style={styles.small}>Ready for future sync</Text>
                </View>
              </View>
              <Action
                title="+  New BEEF draft"
                disabled={busy || (!!error && drafts.length === 0)}
                onPress={() => {
                  void create();
                }}
              />
              <Card>
                <Text style={styles.eyebrow}>BUNDLED TEMPLATE · VERSION 1</Text>
                <Text style={styles.heading}>
                  Basic Education Enrollment Form
                </Text>
                <Text style={styles.body}>{beefTemplate.pilotNotice}</Text>
                <Action
                  title="View both blank reference pages"
                  secondary
                  onPress={() => setViewer({ reference: true, page: 1 })}
                />
              </Card>
              <Text style={styles.heading}>Your drafts</Text>
              {drafts.length === 0 && (
                <Text style={styles.body}>
                  Your first draft starts here. Use fictional typed English data
                  only.
                </Text>
              )}
              {drafts.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => {
                    setDraft(
                      integrity[item.id]?.length
                        ? { ...item, state: "editing" }
                        : item,
                    );
                    setDirty(false);
                    setNotice("");
                    setError("");
                    setRoute({ name: "editor" });
                  }}
                >
                  <Card>
                    <View style={styles.row}>
                      <Text style={styles.eyebrow}>
                        BEEF · V{item.templateVersion}
                      </Text>
                      <Text
                        style={
                          integrity[item.id]?.length
                            ? styles.error
                            : styles.small
                        }
                      >
                        {integrity[item.id]?.length
                          ? "Image missing"
                          : item.state === "ready"
                            ? "Ready for future sync"
                            : "Unfinished"}
                      </Text>
                    </View>
                    <Text style={styles.heading}>
                      {[
                        item.values.learner_first_name,
                        item.values.learner_last_name,
                      ]
                        .filter(Boolean)
                        .join(" ") || "Untitled draft"}
                    </Text>
                    <Text style={styles.small}>
                      {Object.keys(item.pages).length}/2 pages ·{" "}
                      {new Date(item.updatedAt).toLocaleString()}
                    </Text>
                    <Text selectable style={styles.small}>
                      {item.id}
                    </Text>
                  </Card>
                </Pressable>
              ))}
              <Text style={styles.small}>
                Fictional local test profile · Phase 1{"\n"}No sign-in or upload
                in this phase. This app does not approve enrollment or
                authenticate documents.
              </Text>
            </>
          ) : (
            draft && (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    void leave();
                  }}
                  style={{ paddingVertical: 8 }}
                >
                  <Text style={{ ...styles.body, color: colors.teal }}>
                    ← All drafts
                  </Text>
                </Pressable>
                <Text style={styles.eyebrow}>
                  BEEF PILOT · VERSION 1 · PARTIAL EXTRACTION
                </Text>
                <Text style={styles.title}>Capture. Check. Keep.</Text>
                <Text selectable style={styles.small}>
                  Draft {draft.id}
                </Text>
                <Text style={styles.small}>
                  {dirty
                    ? "Unsaved edits - tap Save draft."
                    : draft.state === "ready" && !missing.length
                      ? "Ready for future sync - saved locally."
                      : "Unfinished - saved changes can be resumed offline."}
                </Text>
                {!!missing.length && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    Accepted image missing: page {missing.join(", ")}. This
                    draft is not ready. Retake the missing page before saving.
                  </Text>
                )}
                <Text style={styles.heading}>1. Accept both pages</Text>
                {([1, 2] as const).map((n) => (
                  <Card key={n}>
                    <View style={styles.row}>
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text style={styles.heading}>Page {n}</Text>
                        <Text style={styles.small}>
                          {n === 1
                            ? "Learner information · OCR source"
                            : "Other sections & signature · evidence"}
                        </Text>
                        <Text style={styles.small}>
                          {draft.pages[n] && !missing.includes(n)
                            ? "Accepted in private storage"
                            : "Capture required"}
                        </Text>
                      </View>
                      {draft.pages[n] && !missing.includes(n) && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`View accepted page ${n}`}
                          onPress={() =>
                            setViewer({ reference: false, page: n })
                          }
                        >
                          <Image
                            source={{ uri: draft.pages[n]!.uri }}
                            style={{ width: 64, height: 90, borderRadius: 5 }}
                          />
                        </Pressable>
                      )}
                    </View>
                    <Action
                      title={
                        draft.pages[n]
                          ? `Retake page ${n}`
                          : `Capture page ${n}`
                      }
                      secondary
                      disabled={busy}
                      onPress={() => setRoute({ name: "capture", page: n })}
                    />
                    {draft.pages[n] && (
                      <Action title={`Align saved page ${n}`} secondary disabled={busy || missing.includes(n)}
                        onPress={() => setRoute({ name: "crop", page: n, photo: draft.pages[n]!, savedPhoto: true })} />
                    )}
                    {draft.pages[n] && (
                      <Action
                        title={`View page ${n}`}
                        secondary
                        disabled={busy || missing.includes(n)}
                        onPress={() => setViewer({ reference: false, page: n })}
                      />
                    )}
                  </Card>
                ))}
                <Text style={styles.heading}>2. Read page 1 offline</Text>
                <Text style={styles.body}>
                  Only the seven mapped input areas are read. Checkboxes,
                  signatures, handwriting, and other fields stay outside
                  extraction. All results need your review.
                </Text>
                {draft.pages[1] && !isAligned(draft.pages[1]) && <Text style={styles.warning}>
                  Align saved page 1 before running OCR. Check that the green areas cover the answer boxes below the labels.
                </Text>}
                <Action
                  title={progress || "Run bundled OCR on page 1"}
                  disabled={busy || !draft.pages[1] || !isAligned(draft.pages[1]) || missing.includes(1)}
                  onPress={() => {
                    if (
                      draft.ocrHistory.length ||
                      fieldKeys.some((k) => draft.values[k])
                    )
                      Alert.alert(
                        "Read this page again?",
                        "New OCR values will replace the editable fields. Previous raw OCR runs remain saved.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Run OCR",
                            onPress: () => {
                              void runOcr();
                            },
                          },
                        ],
                      );
                    else void runOcr();
                  }}
                />
                <Text style={styles.heading}>3. Review extracted fields</Text>
                <Text style={styles.body}>
                  Compare with the accepted page. Optional fields may stay
                  blank. Confirm each field after checking it. Manual entry is
                  available when text cannot be read.
                </Text>
                {fieldKeys.map((key) => {
                  const latest = draft.ocrHistory.at(-1);
                  const raw = latest?.fields[key].text;
                  const stale =
                    !!latest && latest.pageImageId !== draft.pages[1]?.imageId;
                  return (
                    <Card key={key}>
                      <Text
                        style={{
                          ...styles.body,
                          color: colors.ink,
                          fontWeight: "700",
                        }}
                      >
                        {fieldLabels[key]}
                      </Text>
                      <TextInput
                        accessibilityLabel={fieldLabels[key]}
                        editable={!busy}
                        style={[
                          styles.input,
                          !!errors[key] && { borderColor: colors.danger },
                        ]}
                        value={
                          key === "birth_date"
                            ? printedDate(draft.values[key])
                            : draft.values[key]
                        }
                        onChangeText={(value) => edit(key, value)}
                        autoCorrect={false}
                        autoCapitalize={
                          key.includes("name") ? "characters" : "none"
                        }
                        keyboardType={
                          ["lrn", "grade_level"].includes(key)
                            ? "number-pad"
                            : "default"
                        }
                        placeholder={
                          key === "birth_date"
                            ? "MM/DD/YYYY"
                            : key === "school_year"
                              ? "2024-2025"
                              : "Enter value"
                        }
                      />
                      <Text selectable style={styles.small}>
                        Original OCR:{" "}
                        {raw === undefined
                          ? "Not run"
                          : raw === ""
                            ? "(blank)"
                            : raw}
                      </Text>
                      {latest?.fields[key].warning === 'label_detected' && <Text style={styles.warning}>
                        A printed field label was read. The proposed value was left blank. Enter the correct value, or confirm an optional blank after checking the page.
                      </Text>}
                      {latest && <Action title="View area read" secondary disabled={busy || missing.includes(1)} onPress={() => setAreaField(key)} />}
                      {stale && (
                        <Text style={styles.warning}>
                          This OCR belongs to the previous page 1 photo. Run OCR
                          again or compare and correct manually.
                        </Text>
                      )}
                      {!!errors[key] && (
                        <Text style={styles.error}>{errors[key]}</Text>
                      )}
                      {!draft.confirmed[key] && (
                        <Text style={styles.warning}>
                          Check this value against page 1
                          {raw === "" ? " - no readable text found" : ""}.
                        </Text>
                      )}
                      <Action
                        title={
                          draft.confirmed[key]
                            ? "✓ Checked against page"
                            : "Confirm this field"
                        }
                        secondary
                        disabled={
                          busy ||
                          !!errors[key] ||
                          !draft.pages[1] ||
                          missing.includes(1)
                        }
                        onPress={() => {
                          setDraft({
                            ...draft,
                            confirmed: {
                              ...draft.confirmed,
                              [key]: !draft.confirmed[key],
                            },
                            state: "editing",
                          });
                          setDirty(true);
                          setNotice("");
                        }}
                      />
                    </Card>
                  );
                })}
                {!!draft.ocrHistory.length && (
                  <Text style={styles.small}>
                    {draft.ocrHistory.length} raw OCR run(s) retained separately
                    from edited values.
                  </Text>
                )}
                {problems.length > 0 && (
                  <Text style={styles.warning}>
                    Unfinished: {problems.length} requirement(s) still need
                    attention. Both accepted pages, valid fields, and seven
                    confirmations are required.
                  </Text>
                )}
                <Action
                  title={busy ? "Working..." : "Save unfinished draft"}
                  secondary
                  disabled={busy}
                  onPress={() => {
                    void saveButton(false);
                  }}
                />
                <Action
                  title="Save as ready for future sync"
                  disabled={busy || problems.length > 0 || missing.length > 0}
                  onPress={() => {
                    void saveButton(true);
                  }}
                />
                {!!notice && (
                  <Text style={{ ...styles.body, color: colors.teal }}>
                    {notice}
                  </Text>
                )}
                {!!error && <Text style={styles.error}>{error}</Text>}
                <Text style={styles.small}>
                  Ready means this local draft is complete. Verification by a
                  staff reviewer belongs to a later phase. Nothing is uploaded
                  automatically.
                </Text>
              </>
            )
          )}
        </ScrollView>
      )}
      {viewer && (
        <PageViewer
          reference={viewer.reference}
          draft={draft}
          initialPage={viewer.page}
          onClose={() => setViewer(null)}
        />
      )}
      {areaField && draft && <FieldAreaViewer field={areaField} page={draft.pages[1]}
        regions={readingRegions(draft.ocrHistory.at(-1), draft.pages[1], areaField)} onClose={() => setAreaField(null)} />}
    </SafeAreaView>
  );
}

function FieldAreaViewer({ field, page, regions, onClose }: { field: FieldKey; page?: Page; regions?: Region[]; onClose: () => void }) {
  const window = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const w = (window.width - 40) * zoom;
  return <Modal onRequestClose={onClose} animationType="slide"><SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{fieldLabels[field]} — area read</Text>
      <Action title="Close" secondary onPress={onClose} />
      {page && regions && !failed ? <>
        <Text style={styles.body}>These are the image areas sent to OCR for this result. Check that they contain the answer, below the printed label.</Text>
        {regions.map((region, i) => <ReadingStrip key={i} uri={page.uri} region={region} width={window.width - 40} imageWidth={page.width} imageHeight={page.height} />)}
        <View style={styles.row}><Action title="− Zoom" secondary disabled={zoom <= 1} onPress={() => setZoom(z => z - 0.5)} />
          <Text style={styles.small}>{Math.round(zoom * 100)}%</Text><Action title="+ Zoom" secondary disabled={zoom >= 3} onPress={() => setZoom(z => z + 0.5)} /></View>
        <ScrollView horizontal><ReadingImage uri={page.uri} width={w} height={w * page.height / page.width} regions={regions} onError={() => setFailed(true)} /></ScrollView>
      </> : <Text style={styles.warning}>{failed ? 'This image could not be opened. Retake the page.' : 'The exact area for this OCR result is unavailable because the photo was replaced or the result came from an older app version. Align page 1 and run OCR again.'}</Text>}
    </ScrollView>
  </SafeAreaView></Modal>;
}

function PageViewer({
  reference,
  draft,
  initialPage,
  onClose,
}: {
  reference: boolean;
  draft: Draft | null;
  initialPage: PageNumber;
  onClose: () => void;
}) {
  const [page, setPage] = useState(initialPage),
    [zoom, setZoom] = useState(1);
  const [imageError, setImageError] = useState(false);
  const window = useWindowDimensions();
  const dimensions = reference
    ? beefTemplate.pages[page - 1]
    : draft?.pages[page];
  const source = reference
    ? references[page]
    : draft?.pages[page]
      ? { uri: draft.pages[page]!.uri }
      : undefined;
  const w = (window.width - 32) * zoom;
  return (
    <Modal onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.eyebrow}>
            {reference ? "BLANK BUNDLED REFERENCE" : "ACCEPTED SOURCE EVIDENCE"}
          </Text>
          <Text style={styles.heading}>BEEF · Page {page} of 2</Text>
          <View style={styles.row}>
            {([1, 2] as const).map((n) => (
              <Action
                key={n}
                title={`Page ${n}`}
                secondary={n !== page}
                onPress={() => {
                  setPage(n);
                  setImageError(false);
                  setZoom(1);
                }}
              />
            ))}
            <Action title="Close" secondary onPress={onClose} />
          </View>
          <View style={styles.row}>
            <Action
              title="− Zoom"
              secondary
              disabled={zoom <= 1}
              onPress={() => setZoom((z) => Math.max(1, z - 0.5))}
            />
            <Text style={styles.small}>{Math.round(zoom * 100)}%</Text>
            <Action
              title="+ Zoom"
              secondary
              disabled={zoom >= 3}
              onPress={() => setZoom((z) => Math.min(3, z + 0.5))}
            />
          </View>
        </View>
        <ScrollView style={{ flex: 1 }}>
          <ScrollView horizontal contentContainerStyle={{ padding: 16 }}>
            {source && dimensions && !imageError ? (
              <Image
                source={source}
                onError={() => setImageError(true)}
                resizeMode="contain"
                style={{
                  width: w,
                  height: (w * dimensions.height) / dimensions.width,
                }}
              />
            ) : (
              <Text style={styles.error}>
                {imageError
                  ? "This image could not be opened. Retake the page."
                  : "This page has not been accepted."}
              </Text>
            )}
          </ScrollView>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Scanner />
    </SafeAreaProvider>
  );
}
