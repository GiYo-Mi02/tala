package expo.modules.talasync;

import androidx.annotation.NonNull;
import androidx.room.Dao;
import androidx.room.Database;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.Insert;
import androidx.room.PrimaryKey;
import androidx.room.Query;
import androidx.room.RoomDatabase;
import java.util.List;

@Database(entities = SyncOutboxDatabase.Record.class, version = 1, exportSchema = false)
public abstract class SyncOutboxDatabase extends RoomDatabase {
    public abstract Outbox outbox();

    @Entity(tableName = "outbox", indices = @Index({"owner", "endpoint", "createdAt"}))
    public static class Record {
        @PrimaryKey @NonNull public String id = "";
        @NonNull public String owner = "";
        @NonNull public String endpoint = "";
        @NonNull public String template = "";
        @NonNull public String capturedAt = "";
        public int pageCount;
        public long createdAt;
        @NonNull public String state = "";
        @NonNull public byte[] snapshot = new byte[0];
        @NonNull public byte[] progress = new byte[0];
    }

    public static class Address {
        @NonNull public String id = "";
        @NonNull public String owner = "";
        @NonNull public String endpoint = "";
    }

    public static class Summary extends Address {
        @NonNull public String template = "";
        @NonNull public String capturedAt = "";
        public int pageCount;
        @NonNull public byte[] progress = new byte[0];
    }

    @Dao
    public interface Outbox {
        @Query("SELECT id, owner, endpoint FROM outbox WHERE state IN ('QUEUED', 'SYNCING') ORDER BY createdAt")
        List<Address> addresses();

        @Query("SELECT * FROM outbox WHERE id = :id")
        Record find(String id);

        @Query("SELECT id, owner, endpoint, template, capturedAt, pageCount, progress FROM outbox WHERE id = :id")
        Summary latest(String id);

        @Query("SELECT id, owner, endpoint, template, capturedAt, pageCount, progress FROM outbox"
            + " WHERE owner = :owner AND endpoint = :endpoint AND (:filter IS NULL OR state = :filter) ORDER BY createdAt DESC")
        List<Summary> list(String owner, String endpoint, String filter);

        @Insert
        void insert(Record record);

        @Query("UPDATE outbox SET state = :state, progress = :progress"
            + " WHERE id = :id AND owner = :owner AND endpoint = :endpoint AND (:previous IS NULL OR state = :previous)")
        int save(String id, String owner, String endpoint, String state, byte[] progress, String previous);
    }
}
